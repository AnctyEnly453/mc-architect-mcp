package dev.mcarchitect;

import com.google.gson.JsonObject;
import java.util.*;
import java.util.concurrent.*;

/** A bounded, disk-backed construction state machine. No file I/O in tick(). */
final class ProjectBuildService implements AutoCloseable {
    private final ProjectStore store;
    private final ProjectWorld world;
    // Shared across world reopenings so old-world checkpoint writes finish before
    // a newly opened service reads the same directory. The worker owns no world objects.
    private static final ExecutorService IO = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "mcarchitect-project-io"); thread.setDaemon(true); return thread;
    });
    private Run run;
    private boolean closed;
    private enum Stage { BOOT, READ, CHUNK, PALETTE, SNAPSHOT, JOURNAL, APPLY, VERIFY, CHECKPOINT }
    private record Boot(ProjectStore.Header header, boolean rollback) {}
    private record Change(int index, String before, String after) {}
    private static final class Run {
        final String id;
        final double budgetMs;
        final int maxBlocks;
        boolean paused, rollback, complete, ticket;
        int cursor, position, palettePosition;
        long writes, chunkStarted;
        double lastTickMs, maxTickMs;
        String error;
        volatile String storageError;
        Stage stage = Stage.BOOT;
        CompletableFuture<?> pending;
        ProjectStore.Header header;
        ProjectStore.Loaded loaded;
        int[] ids;
        int[] expectedIds;
        String[] palette;
        ProjectStore.Cell[] journal;
        List<Change> changes = new ArrayList<>();
        Run(String id, double budgetMs, int maxBlocks) { this.id = id; this.budgetMs = budgetMs; this.maxBlocks = maxBlocks; }
    }
    ProjectBuildService(ProjectStore store, ProjectWorld world) { this.store = store; this.world = world; }

    boolean active() { return run != null && !run.complete; }
    boolean ownsWriter() { return active() && !run.paused; }

    CompletableFuture<Object> request(JsonObject request) {
        if (closed) return CompletableFuture.failedFuture(new IllegalStateException("World is closed"));
        try {
            String action = required(request, "action");
            if (action.equals("list")) return async(() -> store.list());
            if (action.equals("open")) {
                var header = ProjectStore.JSON.fromJson(request, ProjectStore.Header.class);
                if (!world.worldId().equals(header.worldId()) || !world.dimension().equals(header.dimension())) {
                    throw new IllegalArgumentException("Project belongs to a different world or dimension");
                }
                return async(() -> store.open(header));
            }
            String id = required(request, "planId");
            store.directory(id);
            return switch (action) {
                case "upload" -> {
                    int index = request.get("index").getAsInt();
                    String data = required(request, "data");
                    yield async(() -> { store.upload(id, index, data); return Map.of("uploaded", index, "planId", id); });
                }
                case "status" -> {
                    if (run != null && run.id.equals(id)) yield CompletableFuture.completedFuture(status());
                    yield async(() -> Map.of("header", store.readHeader(id), "checkpoint", store.readProgress(id),
                            "active", false, "requiresExplicitResume", true));
                }
                case "start", "resume", "rollback" -> start(id, action, request);
                case "pause" -> {
                    if (run == null || !run.id.equals(id) || run.complete) throw new IllegalStateException("Project is not active");
                    pause(null);
                    yield CompletableFuture.completedFuture(status());
                }
                default -> throw new IllegalArgumentException("Unknown project action: " + action);
            };
        } catch (Exception exception) { return CompletableFuture.failedFuture(exception); }
    }

    private CompletableFuture<Object> start(String id, String action, JsonObject request) {
        if (ownsWriter()) throw new IllegalStateException("Pause the active project first");
        double budget = request.has("tickBudgetMs") ? request.get("tickBudgetMs").getAsDouble() : 4;
        int maximum = request.has("maxBlocksPerTick") ? request.get("maxBlocksPerTick").getAsInt() : 8192;
        if (!Double.isFinite(budget) || budget < 0.25 || budget > 10 || maximum < 1 || maximum > 8192) {
            throw new IllegalArgumentException("tickBudgetMs must be 0.25..10; maxBlocksPerTick must be 1..8192");
        }
        releaseTicket();
        run = new Run(id, budget, maximum);
        String expectedWorld = world.worldId(), expectedDimension = world.dimension();
        run.pending = async(() -> {
            ProjectStore.Header header = store.seal(id);
            if (!header.worldId().equals(expectedWorld) || !header.dimension().equals(expectedDimension)) {
                throw new IllegalArgumentException("Project belongs to a different world or dimension");
            }
            var marker = store.directory(id).resolve("rollback");
            boolean rollback = java.nio.file.Files.exists(marker) || action.equals("rollback");
            if (rollback && !java.nio.file.Files.exists(marker)) ProjectStore.atomicWrite(marker, new byte[] { 1 });
            store.progress(id, new ProjectStore.Progress(rollback ? "rolling_back" : "running", 0, 0, null));
            return new Boot(header, rollback);
        });
        return CompletableFuture.completedFuture(status());
    }

    Object status() {
        if (run == null) return Map.of("active", false);
        var result = new LinkedHashMap<String, Object>();
        result.put("planId", run.id);
        result.put("active", !run.complete);
        result.put("status", run.complete ? (run.rollback ? "rolled_back" : "complete") : run.paused ? "paused" : "running");
        result.put("direction", run.rollback ? "rollback" : "build");
        result.put("stage", run.stage.name().toLowerCase(Locale.ROOT));
        result.put("processedSections", run.header == null ? 0 : run.rollback ? run.header.sectionCount() - 1 - run.cursor : run.cursor);
        if (run.header != null) result.put("sectionCount", run.header.sectionCount());
        result.put("writtenBlocksThisSession", run.writes);
        result.put("tickBudgetMs", run.budgetMs);
        result.put("lastTickMs", run.lastTickMs);
        result.put("maxTickMs", run.maxTickMs);
        result.put("loadedWorkChunks", run.ticket ? 1 : 0);
        result.put("recovery", "Every resume rechecks journaled sections against world blocks; cursor is not trusted");
        if (run.error != null) result.put("error", run.error);
        if (run.storageError != null) result.put("checkpointError", run.storageError);
        if (run.loaded != null) result.put("section", run.loaded.section().key());
        return result;
    }

    void tick() {
        if (closed || run == null || run.complete || run.paused) return;
        long started = System.nanoTime();
        long deadline = started + (long) (run.budgetMs * 1_000_000);
        int work = 0;
        try {
            while (!run.complete && !run.paused && System.nanoTime() < deadline && work < run.maxBlocks) {
                if (run.pending != null && !run.pending.isDone()) {
                    if (run.stage == Stage.CHUNK && System.nanoTime() - run.chunkStarted > 60_000_000_000L) {
                        throw new IllegalStateException("Chunk loading timed out; resume to retry");
                    }
                    break;
                }
                switch (run.stage) {
                    case BOOT -> {
                        Boot boot = (Boot) takePending(); run.header = boot.header; run.rollback = boot.rollback;
                        world.bindDimension(run.header.dimension());
                        // Reconcile from the beginning even after a checkpoint says complete.
                        run.cursor = run.rollback ? run.header.sectionCount() - 1 : 0;
                        readNext();
                    }
                    case READ -> {
                        run.loaded = (ProjectStore.Loaded) takePending();
                        if (run.rollback && run.loaded.journal() == null) { finishSection(); break; }
                        ProjectStore.Section section = run.loaded.section();
                        world.validateHeight(section.y() * 16, section.y() * 16 + 15);
                        run.ids = section.decode();
                        run.expectedIds = section.expected() == null ? null : new ProjectStore.Section(section.x(), section.y(), section.z(),
                                section.expected().palette(), section.expected().runs()).decode();
                        run.palette = new String[section.palette().size()]; run.palettePosition = 1;
                        run.journal = new ProjectStore.Cell[4096]; run.changes = new ArrayList<>(); run.position = 0;
                        if (run.loaded.journal() != null) {
                            for (var cell : run.loaded.journal().cells()) run.journal[cell.index()] = cell;
                        }
                        run.chunkStarted = System.nanoTime();
                        run.ticket = true;
                        run.pending = world.loadChunk(section.x(), section.z()); run.stage = Stage.CHUNK;
                    }
                    case CHUNK -> { takePending(); run.stage = Stage.PALETTE; }
                    case PALETTE -> {
                        if (run.palettePosition == run.palette.length) { run.stage = Stage.SNAPSHOT; break; }
                        int index = run.palettePosition++;
                        run.palette[index] = world.canonical(run.loaded.section().palette().get(index)); work++;
                    }
                    case SNAPSHOT -> {
                        if (run.position == 4096) { persistBeforeImage(); break; }
                        int index=run.position++;
                        // KEEP cells do not access the world and must not consume the block quota.
                        if (run.rollback ? run.journal[index] != null : run.ids[index] != 0) { snapshot(index); work++; }
                    }
                    case JOURNAL -> { takePending(); run.position = 0; run.stage = Stage.APPLY; }
                    case APPLY -> {
                        if (run.position == run.changes.size()) { run.position = 0; run.stage = Stage.VERIFY; break; }
                        apply(run.changes.get(run.position++)); work++;
                    }
                    case VERIFY -> {
                        if (run.position == 4096) { finishSection(); break; }
                        int index=run.position++;
                        if (run.rollback ? run.journal[index] != null : run.ids[index] != 0) { verify(index); work++; }
                    }
                    case CHECKPOINT -> { takePending(); releaseTicket(); readNext(); }
                }
            }
        } catch (Exception exception) {
            Throwable cause = exception instanceof CompletionException && exception.getCause() != null ? exception.getCause() : exception;
            pause(cause.getMessage() == null ? cause.toString() : cause.getMessage());
        } finally {
            run.lastTickMs = (System.nanoTime() - started) / 1_000_000.0;
            run.maxTickMs = Math.max(run.maxTickMs, run.lastTickMs);
        }
    }
    private void snapshot(int index) {
        var cell = run.journal[index];
        if (run.rollback && cell == null || !run.rollback && run.ids[index] == 0) return;
        String current = read(index);
        String after = run.rollback ? world.canonical(cell.before()) : run.palette[run.ids[index]];
        if (run.loaded.journal() == null) {
            if (run.expectedIds != null && run.expectedIds[index] != 0 && !same(current, after)
                    && !same(current, world.canonical(run.loaded.section().expected().palette().get(run.expectedIds[index])))) conflict(index);
            if (!same(current, after)) {
                checkWritable(index);
                run.changes.add(new Change(index, current, after));
            }
        } else {
            String before = cell == null ? null : world.canonical(run.rollback ? cell.after() : cell.before());
            if (!run.rollback && cell != null && !world.canonical(cell.after()).equals(after)) {
                throw new IllegalStateException("Journal target differs at " + coordinates(index));
            }
            if (!same(current, after) && !same(current, before)) conflict(index);
            if (cell != null) run.changes.add(new Change(index, before, after));
        }
    }
    private void persistBeforeImage() {
        run.position = 0;
        if (run.loaded.journal() != null) { run.stage = Stage.APPLY; return; }
        String id = run.id; int cursor = run.cursor;
        var cells = run.changes.stream().map(change -> new ProjectStore.Cell(change.index, change.before, change.after)).toList();
        var journal = new ProjectStore.Journal(run.loaded.hash(), cells);
        // The future must complete successfully before APPLY is reachable.
        run.pending = async(() -> { store.journal(id, cursor, journal); return true; });
        run.stage = Stage.JOURNAL;
    }
    private void apply(Change change) {
        String current = read(change.index);
        if (same(current, change.after)) return;
        if (!same(current, change.before)) conflict(change.index);
        checkWritable(change.index);
        var section = run.loaded.section();
        world.write(section.x() * 16 + change.index % 16, section.y() * 16 + change.index / 256,
                section.z() * 16 + change.index / 16 % 16, change.after);
        run.writes++;
    }
    private void verify(int index) {
        if (run.rollback) {
            var cell = run.journal[index];
            if (cell != null && !same(read(index), world.canonical(cell.before()))) conflict(index);
        } else if (run.ids[index] != 0 && !same(read(index), run.palette[run.ids[index]])) {
            throw new IllegalStateException("Post-write mismatch at " + coordinates(index) + "; inspect neighbor updates or block physics");
        }
    }
    private void finishSection() {
        run.cursor += run.rollback ? -1 : 1;
        String id = run.id;
        boolean done = run.cursor < 0 || run.cursor == run.header.sectionCount();
        var progress = new ProjectStore.Progress(done ? (run.rollback ? "rolled_back" : "complete")
                : run.rollback ? "rolling_back" : "running", run.cursor, run.writes, null);
        run.pending = async(() -> { store.progress(id, progress); return true; });
        run.stage = Stage.CHECKPOINT;
    }
    private void readNext() {
        if (run.cursor < 0 || run.cursor == run.header.sectionCount()) {
            run.complete = true; run.loaded = null; run.changes.clear(); return;
        }
        String id = run.id; int index = run.cursor;
        run.loaded = null; run.changes.clear();
        run.pending = async(() -> store.load(id, index)); run.stage = Stage.READ;
    }
    private Object takePending() {
        Object value = run.pending.join(); run.pending = null; return value;
    }
    private String read(int index) {
        var section = run.loaded.section();
        return world.read(section.x() * 16 + index % 16, section.y() * 16 + index / 256, section.z() * 16 + index / 16 % 16);
    }
    private String coordinates(int index) {
        var section = run.loaded.section();
        return (section.x() * 16 + index % 16) + "," + (section.y() * 16 + index / 256) + "," + (section.z() * 16 + index / 16 % 16);
    }
    private void checkWritable(int index) {
        var section = run.loaded.section();
        world.checkWritable(section.x() * 16 + index % 16, section.y() * 16 + index / 256, section.z() * 16 + index / 16 % 16);
    }
    private void conflict(int index) { throw new IllegalStateException("External block change at " + coordinates(index) + "; inspect before resuming"); }
    private boolean same(String actual, String expected) { return StateRules.equivalent(actual, expected, run.loaded.section().statePolicy()); }
    private void pause(String error) {
        run.paused = true; run.error = error; releaseTicket();
        String id = run.id;
        var progress = new ProjectStore.Progress(run.rollback ? "rollback_paused" : "paused", run.cursor, run.writes, error);
        // Before-images remain authoritative even if writing this advisory cursor fails.
        Run pausedRun = run;
        async(() -> { store.progress(id, progress); return true; }).exceptionally(failure -> {
            pausedRun.storageError = failure.toString(); return null;
        });
    }
    private void releaseTicket() {
        if (run != null && run.ticket && run.loaded != null) {
            world.releaseChunk(run.loaded.section().x(), run.loaded.section().z()); run.ticket = false;
        }
    }
    private static String required(JsonObject object, String key) {
        if (!object.has(key) || object.get(key).isJsonNull()) throw new IllegalArgumentException(key + " is required");
        return object.get(key).getAsString();
    }
    private interface IOAction { Object get() throws Exception; }
    private CompletableFuture<Object> async(IOAction action) {
        return CompletableFuture.supplyAsync(() -> {
            try { return action.get(); } catch (Exception exception) { throw new CompletionException(exception); }
        }, IO);
    }
    @Override public void close() {
        if (closed) return;
        if (active()) pause("World closed; resume explicitly to reconcile blocks");
        closed = true;
    }
}
