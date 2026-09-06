package dev.mcarchitect;

import com.google.gson.JsonObject;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Persistent ordered stages. Stage target cells are disjoint, so replay is unambiguous. */
final class AssemblyBuildService implements AutoCloseable {
    record Step(String name, String planId) {}
    record Spec(String id, String worldId, String dimension, List<Step> steps) {}
    record Checkpoint(String status, int cursor, String error) {}
    record Boot(Spec spec, boolean rollback) {}
    private static final ExecutorService IO = Executors.newSingleThreadExecutor(r -> { var t = new Thread(r, "mcengineer-assembly-io"); t.setDaemon(true); return t; });
    private final ProjectStore store;
    private final ProjectBuildService projects;
    private final ProjectWorld world;
    private Spec spec;
    private String id, error;
    private boolean paused, complete, rollback, launched, closed;
    private int cursor;
    private CompletableFuture<?> pending;
    private boolean booting;
    AssemblyBuildService(ProjectStore store, ProjectBuildService projects, ProjectWorld world) { this.store = store; this.projects = projects; this.world = world; }
    boolean ownsWriter() { return id != null && !paused && !complete; }
    private Path directory(String value) {
        if (value == null || !value.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid assembly ID");
        return store.root.resolveSibling("assemblies").resolve(value);
    }
    CompletableFuture<Object> request(JsonObject request) {
        try {
            if (closed) throw new IllegalStateException("World is closed");
            String action = request.get("action").getAsString(), requested = request.get("id").getAsString(); directory(requested);
            if (action.equals("status")) {
                if (requested.equals(id)) return CompletableFuture.completedFuture(status());
                return async(() -> Map.of("id", requested, "active", false, "checkpoint", readCheckpoint(requested), "requiresExplicitResume", true));
            }
            if (action.equals("pause")) {
                if (!requested.equals(id) || complete) throw new IllegalStateException("Assembly is not active");
                pause(null); return CompletableFuture.completedFuture(status());
            }
            if (!Set.of("start", "resume", "rollback").contains(action)) throw new IllegalArgumentException("Unknown assembly action");
            if (ownsWriter() && requested.equals(id) && action.equals("start")) return CompletableFuture.completedFuture(status());
            if (ownsWriter() || projects.ownsWriter()) throw new IllegalStateException("Pause the active writer first");
            String expectedWorld = world.worldId(), dimension = world.dimension();
            Spec supplied = action.equals("start") ? ProjectStore.JSON.fromJson(request, Spec.class) : null;
            id = requested; spec = null; error = null; paused = false; complete = false; launched = false; booting = true;
            pending = async(() -> {
                Path root = directory(requested), manifest = root.resolve("manifest.json");
                Spec source;
                if (supplied != null) {
                    validateSpec(supplied);
                    if (Files.exists(manifest)) {
                        source = ProjectStore.JSON.fromJson(Files.readString(manifest), Spec.class);
                        if (!source.equals(supplied)) throw new IllegalArgumentException("Immutable assembly differs");
                    } else { source = supplied; write(manifest, source); }
                } else source = ProjectStore.JSON.fromJson(Files.readString(manifest), Spec.class);
                validateSpec(source);
                if (!expectedWorld.equals(source.worldId) || !dimension.equals(source.dimension)) throw new IllegalArgumentException("Assembly belongs to another world/dimension");
                validateOwnership(source);
                Path marker = root.resolve("rollback");
                boolean reverse = Files.exists(marker) || action.equals("rollback");
                if (reverse && !Files.exists(marker)) ProjectStore.atomicWrite(marker, new byte[] { 1 });
                write(root.resolve("progress.json"), new Checkpoint(reverse ? "rolling_back" : "running", 0, null));
                return new Boot(source, reverse);
            });
            return CompletableFuture.completedFuture(status());
        } catch (Exception exception) { return CompletableFuture.failedFuture(exception); }
    }
    Object status() {
        if (id == null) return Map.of("active", false);
        var result = new LinkedHashMap<String, Object>(); result.put("id", id); result.put("active", !complete);
        result.put("status", complete ? rollback ? "rolled_back" : "complete" : paused ? "paused" : "running");
        result.put("direction", rollback ? "rollback" : "build");
        if (spec != null) {
            result.put("stageCount", spec.steps.size()); result.put("processedStages", rollback ? spec.steps.size() - cursor - 1 : cursor);
            if (cursor >= 0 && cursor < spec.steps.size()) result.put("stage", spec.steps.get(cursor).name);
        }
        if (launched) result.put("construction", projects.status()); if (error != null) result.put("error", error); return result;
    }
    void tick() {
        if (!ownsWriter()) return;
        try {
            if (pending != null) {
                if (!pending.isDone()) return;
                Object value = pending.join(); pending = null;
                if (booting) {
                    Boot boot = (Boot) value; spec = boot.spec; rollback = boot.rollback;
                    cursor = rollback ? spec.steps.size() - 1 : 0; booting = false;
                }
            }
            if (cursor < 0 || cursor == spec.steps.size()) { complete = true; return; }
            if (!launched) {
                var request = new JsonObject(); request.addProperty("action", rollback ? "rollback" : "resume");
                request.addProperty("planId", spec.steps.get(cursor).planId);
                projects.request(request).join(); launched = true; return;
            }
            JsonObject current = ProjectStore.JSON.toJsonTree(projects.status()).getAsJsonObject();
            if (!current.get("planId").getAsString().equals(spec.steps.get(cursor).planId)) throw new IllegalStateException("Child project was replaced externally");
            if (current.get("status").getAsString().equals("paused")) {
                pause(current.has("error") ? current.get("error").getAsString() : "Stage paused"); return;
            }
            if (!current.get("active").getAsBoolean()) {
                if (!current.get("status").getAsString().equals(rollback ? "rolled_back" : "complete")) throw new IllegalStateException("Stage has entered a different irreversible direction");
                cursor += rollback ? -1 : 1; launched = false;
                boolean done = cursor < 0 || cursor == spec.steps.size();
                String value = id; var checkpoint = new Checkpoint(done ? rollback ? "rolled_back" : "complete" : rollback ? "rolling_back" : "running", cursor, null);
                pending = async(() -> { write(directory(value).resolve("progress.json"), checkpoint); return true; });
            }
        } catch (Exception exception) {
            Throwable cause = exception; while (cause.getCause() != null) cause = cause.getCause(); pause(cause.toString());
        }
    }
    private void pause(String reason) {
        paused = true; error = reason;
        if (launched) {
            var current = ProjectStore.JSON.toJsonTree(projects.status()).getAsJsonObject();
            if (current.get("active").getAsBoolean()) {
                var request = new JsonObject(); request.addProperty("action", "pause"); request.addProperty("planId", current.get("planId").getAsString());
                projects.request(request).join();
            }
        }
        String value = id; var checkpoint = new Checkpoint(rollback ? "rollback_paused" : "paused", cursor, error);
        async(() -> { write(directory(value).resolve("progress.json"), checkpoint); return true; });
    }
    private void validateSpec(Spec source) {
        directory(source.id);
        if (source.steps == null || source.steps.isEmpty() || source.steps.size() > 4096) throw new IllegalArgumentException("Assembly requires 1..4096 stages");
        Set<String> seen = new HashSet<>();
        for (Step step : source.steps) {
            if (step == null || step.name == null || step.name.length() > 100 || !seen.add(step.planId)) throw new IllegalArgumentException("Invalid/duplicate stage");
            store.directory(step.planId);
        }
        if (!ProjectStore.hash(String.join("\n", source.steps.stream().map(Step::planId).toList())).equals(source.id)) throw new IllegalArgumentException("Assembly digest mismatch");
    }
    private record Reference(String planId, int index) {}
    private void validateOwnership(Spec source) throws Exception {
        // Only section references remain in memory; voxel ownership uses one BitSet at a time.
        Map<String, List<Reference>> sections = new HashMap<>();
        for (Step step : source.steps) {
            var header = store.seal(step.planId);
            if (!Objects.equals(header.worldId(), source.worldId) || !Objects.equals(header.dimension(), source.dimension)) throw new IllegalArgumentException("Stage identity mismatch");
            for (int i = 0; i < header.sectionCount(); i++) {
                var section = ProjectStore.JSON.fromJson(Files.readString(store.sectionFile(step.planId, i)), ProjectStore.Section.class);
                sections.computeIfAbsent(section.key(), key -> new ArrayList<>()).add(new Reference(step.planId, i));
            }
        }
        for (var refs : sections.values()) {
            BitSet used = new BitSet(4096);
            for (var ref : refs) {
                int[] ids = ProjectStore.JSON.fromJson(Files.readString(store.sectionFile(ref.planId, ref.index)), ProjectStore.Section.class).decode();
                for (int i = 0; i < 4096; i++) if (ids[i] != 0) {
                    if (used.get(i)) throw new IllegalArgumentException("Stages overlap target cells; compile a disjoint final-state stage plan");
                    used.set(i);
                }
            }
        }
    }
    private Checkpoint readCheckpoint(String value) throws Exception { return ProjectStore.JSON.fromJson(Files.readString(directory(value).resolve("progress.json")), Checkpoint.class); }
    private static void write(Path path, Object data) throws Exception { ProjectStore.atomicWrite(path, ProjectStore.JSON.toJson(data).getBytes(StandardCharsets.UTF_8)); }
    private interface Action { Object run() throws Exception; }
    private CompletableFuture<Object> async(Action action) {
        return CompletableFuture.supplyAsync(() -> { try { return action.run(); } catch (Exception e) { throw new CompletionException(e); } }, IO);
    }
    @Override public void close() { if (closed) return; if (ownsWriter()) pause("World closed; resume explicitly"); closed = true; }
}
