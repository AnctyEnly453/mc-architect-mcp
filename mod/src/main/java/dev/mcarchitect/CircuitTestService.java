package dev.mcarchitect;

import com.google.gson.JsonObject;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Real game-tick stimulus/observation, with durable input restoration records. */
final class CircuitTestService implements AutoCloseable {
    record Point(int x, int y, int z) {}
    record Bounds(Point from, Point to) {}
    record Input(String id, Point position) {}
    record Probe(String id, Point position, String face) {}
    record Event(int tick, Map<String, Boolean> set) {}
    record Assertion(int tick, String probe, int min, int max) {}
    record Spec(String id, String name, String worldId, String dimension, Bounds bounds, List<Input> inputs,
                List<Probe> probes, List<Event> events, List<Assertion> assertions, int durationTicks, int sampleEveryTicks, boolean retainInputs) {
        Spec(String id, String name, String worldId, String dimension, Bounds bounds, List<Input> inputs, List<Probe> probes,
             List<Event> events, List<Assertion> assertions, int durationTicks, int sampleEveryTicks) {
            this(id, name, worldId, dimension, bounds, inputs, probes, events, assertions, durationTicks, sampleEveryTicks, false);
        }
    }
    record Frame(int tick, Map<String, Integer> values) {}
    record Check(int tick, String probe, int actual, int min, int max, boolean passed) {}
    record Before(Spec spec, Map<String, String> states) {}
    private static final ExecutorService IO = Executors.newSingleThreadExecutor(r -> { var t = new Thread(r, "mcengineer-circuit-io"); t.setDaemon(true); return t; });
    private final CircuitWorld world;
    private final Path root;
    private Spec spec;
    private String state = "idle", error, outcome;
    private Map<String, String> before;
    private final List<Frame> trace = new ArrayList<>();
    private final List<Check> checks = new ArrayList<>();
    private CompletableFuture<?> pending;
    private long began, loadingAt;
    private int elapsed = -1;
    private boolean stop, driven, recovery, closed;
    CircuitTestService(CircuitWorld world, Path root) { this.world = world; this.root = root; }
    boolean ownsWriter() { return !Set.of("idle", "complete", "cancelled", "failed", "interrupted").contains(state); }
    private Path directory(String id) {
        try { UUID.fromString(id); } catch (Exception e) { throw new IllegalArgumentException("Circuit test ID must be a UUID"); }
        return root.resolve(id);
    }
    CompletableFuture<Object> request(JsonObject request) {
        try {
            if (closed) throw new IllegalStateException("World is closed");
            String action = request.get("action").getAsString(), id = request.get("id").getAsString(); directory(id);
            if (action.equals("status")) {
                if (spec != null && spec.id.equals(id)) return CompletableFuture.completedFuture(status());
                return async(() -> {
                    Path result = directory(id).resolve("result.json");
                    if (Files.exists(result)) return ProjectStore.JSON.fromJson(Files.readString(result), JsonObject.class);
                    return Map.of("id", id, "status", "interrupted", "requiresInputRestore", Files.exists(directory(id).resolve("before.json")));
                });
            }
            if (action.equals("cancel")) {
                if (spec == null || !spec.id.equals(id) || !ownsWriter()) throw new IllegalStateException("Test is not active");
                stop = true; return CompletableFuture.completedFuture(status());
            }
            if (!Set.of("start", "restore").contains(action)) throw new IllegalArgumentException("Unknown circuit action");
            if (ownsWriter()) {
                if (spec.id.equals(id) && action.equals("start")) return CompletableFuture.completedFuture(status());
                throw new IllegalStateException("Another circuit test is active");
            }
            if (spec != null && spec.id.equals(id) && action.equals("start")) return CompletableFuture.completedFuture(status());
            Spec supplied = action.equals("start") ? ProjectStore.JSON.fromJson(request, Spec.class) : null;
            if (supplied != null) validate(supplied);
            trace.clear(); checks.clear(); before = null; error = null; stop = false; driven = false; elapsed = -1;
            recovery = action.equals("restore"); outcome = recovery ? "cancelled" : "complete";
            if (recovery) {
                // Keep the ID visible while loading its durable restore record.
                spec = new Spec(id, "input recovery", world.worldId(), world.dimension(), null, List.of(), List.of(), List.of(), List.of(), 1, 1);
                state = "recovering";
                pending = async(() -> ProjectStore.JSON.fromJson(Files.readString(directory(id).resolve("before.json")), Before.class));
            } else {
                spec = supplied;
                state = "checking"; Spec value = spec;
                pending = async(() -> {
                    Path path = directory(id).resolve("before.json");
                    if (Files.exists(path)) throw new IllegalStateException("Test ID exists; inspect/restore it or use a new ID");
                    return value;
                });
            }
            return CompletableFuture.completedFuture(status());
        } catch (Exception e) { return CompletableFuture.failedFuture(e); }
    }
    boolean inDimension(String dimension) { return spec != null && spec.dimension.equals(dimension); }
    Object status() {
        var result = new LinkedHashMap<String, Object>();
        result.put("status", state); result.put("active", ownsWriter());
        result.put("timeUnit", "logical circuit ticks; redstone substeps when acceleration is enabled");
        if (spec != null) {
            result.put("id", spec.id); result.put("name", spec.name); result.put("elapsedTicks", Math.max(0, elapsed));
            result.put("durationTicks", spec.durationTicks); result.put("tracePath", directory(spec.id).resolve("trace.json").toString());
        }
        result.put("assertionsEvaluated", checks.size()); result.put("failures", checks.stream().filter(c -> !c.passed).toList());
        result.put("inputRecovery", recovery);
        result.put("passed", state.equals("complete") && spec != null && !spec.assertions.isEmpty()
                && checks.size() == spec.assertions.size() && checks.stream().allMatch(Check::passed));
        result.put("recentTrace", trace.subList(Math.max(0, trace.size() - 16), trace.size()));
        if (error != null) result.put("error", error); return result;
    }
    void tick() {
        if (!ownsWriter()) return;
        try {
            if (pending != null) {
                if (!pending.isDone()) {
                    if (state.equals("loading") && System.nanoTime() - loadingAt > 60_000_000_000L) throw new IllegalStateException("Circuit chunk loading timed out");
                    return;
                }
                Object result = pending.join(); pending = null;
                switch (state) {
                    case "recovering" -> { Before saved = (Before) result; spec = saved.spec; before = saved.states; validate(spec); beginLoad(); return; }
                    case "checking" -> { beginLoad(); return; }
                    case "loading" -> {
                        if (recovery) { state = "restoring"; break; }
                        before = new LinkedHashMap<>();
                        for (Input input : spec.inputs) before.put(input.id, world.inputState(input));
                        Before snapshot = new Before(spec, Map.copyOf(before)); String id = spec.id;
                        pending = async(() -> { write(directory(id).resolve("before.json"), snapshot); return true; });
                        state = "saving_before"; return;
                    }
                    case "saving_before" -> { began = world.gameTick(); state = "running"; }
                    case "saving_result" -> { state = outcome; return; }
                    default -> throw new IllegalStateException("Unexpected circuit I/O state " + state);
                }
            }
            if (stop && state.equals("running")) { outcome = "cancelled"; state = "restoring"; }
            if (state.equals("running")) {
                int now = Math.toIntExact(world.gameTick() - began);
                if (now == elapsed) return;
                if (now != elapsed + 1) throw new IllegalStateException("A game tick was missed; stimuli were not replayed at a false time");
                elapsed = now;
                for (Event event : spec.events) if (event.tick == elapsed) {
                    for (var entry : event.set.entrySet()) {
                        Input input = spec.inputs.stream().filter(i -> i.id.equals(entry.getKey())).findFirst().orElseThrow();
                        driven = true; world.drive(input, entry.getValue(), before.get(input.id));
                    }
                }
                boolean assertionsNow = spec.assertions.stream().anyMatch(a -> a.tick == elapsed);
                if (elapsed % spec.sampleEveryTicks == 0 || assertionsNow) {
                    var values = new LinkedHashMap<String, Integer>();
                    for (Probe probe : spec.probes) values.put(probe.id, world.sample(probe));
                    trace.add(new Frame(elapsed, values));
                    for (Assertion assertion : spec.assertions) if (assertion.tick == elapsed) {
                        int actual = values.get(assertion.probe);
                        checks.add(new Check(elapsed, assertion.probe, actual, assertion.min, assertion.max, actual >= assertion.min && actual <= assertion.max));
                        if(spec.retainInputs && (actual < assertion.min || actual > assertion.max)) throw new IllegalStateException("Keyboard verification failed: " + assertion.probe + " at " + elapsed);
                    }
                }
                if (elapsed >= spec.durationTicks) state = "restoring";
            }
            if (state.equals("restoring")) {
                if (!spec.retainInputs || recovery || !outcome.equals("complete") || checks.stream().anyMatch(c -> !c.passed)) restoreInputs();
                finish();
            }
        } catch (Exception exception) {
            Throwable cause = exception; while (cause.getCause() != null) cause = cause.getCause();
            error = cause.toString(); outcome = "failed";
            try { if (driven || recovery) restoreInputs(); }
            catch (Exception restoration) { error += "; input restoration failed: " + restoration; }
            // Do not recursively try to persist a failed persistence operation.
            if (Set.of("saving_result", "checking", "recovering").contains(state)) { world.release(); state = "failed"; }
            else finish();
        }
    }
    private void restoreInputs() {
        if (before == null) return;
        var failures = new ArrayList<String>();
        for (Input input : spec.inputs) if (before.containsKey(input.id)) {
            try { world.restore(input, before.get(input.id)); }
            catch (Exception e) { failures.add(input.id + ": " + e.getMessage()); }
        }
        if (!failures.isEmpty()) throw new IllegalStateException("Input restore conflicts: " + String.join("; ", failures));
    }
    private void beginLoad() { state = "loading"; loadingAt = System.nanoTime(); pending = world.load(spec); }
    private void finish() {
        world.release(); String id = spec.id; List<Frame> frames = List.copyOf(trace);
        state = outcome; Object result = status(); state = "saving_result"; boolean restored = recovery;
        pending = async(() -> {
            if (restored) write(directory(id).resolve("recovery.json"), result);
            else { write(directory(id).resolve("trace.json"), frames); write(directory(id).resolve("result.json"), result); }
            if (spec.retainInputs && outcome.equals("complete") && error == null) Files.deleteIfExists(directory(id).resolve("before.json"));
            return true;
        });
    }
    private void validate(Spec source) {
        directory(source.id);
        if (!world.worldId().equals(source.worldId) || !world.dimension().equals(source.dimension)) throw new IllegalArgumentException("Wrong circuit world/dimension");
        if (source.bounds == null || source.bounds.from == null || source.bounds.to == null || source.inputs == null || source.inputs.size() > 64
                || source.probes == null || source.probes.isEmpty() || source.probes.size() > 64 || source.events == null || source.events.size() > 4096
                || source.assertions == null || source.assertions.size() > 4096 || source.durationTicks < 1 || source.durationTicks > 48000
                || source.sampleEveryTicks < 1 || source.sampleEveryTicks > 100 || source.durationTicks / Math.max(1, source.sampleEveryTicks) > 6000) throw new IllegalArgumentException("Invalid circuit test limits");
        long width = (long) Math.floorDiv(source.bounds.to.x, 16) - Math.floorDiv(source.bounds.from.x, 16) + 1;
        long depth = (long) Math.floorDiv(source.bounds.to.z, 16) - Math.floorDiv(source.bounds.from.z, 16) + 1;
        if (width < 1 || depth < 1 || width * depth > 384 || source.bounds.from.y > source.bounds.to.y) throw new IllegalArgumentException("Test region must cover at most 384 chunks with ordered corners");
        Set<String> inputs = new HashSet<>(), probes = new HashSet<>(), positions = new HashSet<>();
        for (Input input : source.inputs) {
            if (input.id == null || !inputs.add(input.id) || !positions.add(input.position.toString())) throw new IllegalArgumentException("Duplicate input");
            inside(input.position, source.bounds);
        }
        for (Probe probe : source.probes) {
            if (probe.id == null || !probes.add(probe.id) || !Set.of("north", "east", "south", "west", "up", "down", "wire", "received").contains(probe.face)) throw new IllegalArgumentException("Invalid probe");
            inside(probe.position, source.bounds);
        }
        Set<String> drives = new HashSet<>();
        for (Event event : source.events) {
            if (event.tick < 0 || event.tick > source.durationTicks || event.set == null) throw new IllegalArgumentException("Invalid event tick");
            for (var entry : event.set.entrySet()) if (!inputs.contains(entry.getKey()) || entry.getValue() == null || !drives.add(event.tick + ":" + entry.getKey())) throw new IllegalArgumentException("Invalid/duplicate drive");
        }
        for (Assertion check : source.assertions) if (check.tick < 0 || check.tick > source.durationTicks || !probes.contains(check.probe)
                || check.min < 0 || check.max > 15 || check.min > check.max) throw new IllegalArgumentException("Invalid signal assertion");
    }
    private static void inside(Point p, Bounds b) {
        if (p == null || p.x < b.from.x || p.x > b.to.x || p.y < b.from.y || p.y > b.to.y || p.z < b.from.z || p.z > b.to.z) throw new IllegalArgumentException("Port outside test region");
    }
    private static void write(Path path, Object value) throws Exception { ProjectStore.atomicWrite(path, ProjectStore.JSON.toJson(value).getBytes(StandardCharsets.UTF_8)); }
    private interface Action { Object get() throws Exception; }
    private CompletableFuture<Object> async(Action action) {
        return CompletableFuture.supplyAsync(() -> { try { return action.get(); } catch (Exception e) { throw new CompletionException(e); } }, IO);
    }
    @Override public void close() { if (ownsWriter()) { world.release(); state = "interrupted"; } closed = true; }
}
