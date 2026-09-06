package dev.mcarchitect;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.block.*;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.ticks.LevelTicks;
import net.minecraft.world.ticks.ScheduledTick;
import dev.mcarchitect.mixin.LevelTicksAccessor;

/** An opt-in redstone clock. World/entity/fluid time remains untouched. */
public final class RedstoneEngine implements AutoCloseable {
    private static final Map<ServerLevel, RedstoneEngine> LEVELS = new ConcurrentHashMap<>();
    private static final Map<LevelTicks<?>, RedstoneEngine> QUEUES = new ConcurrentHashMap<>();
    private record Key(BlockPos pos, Block block) {}
    private final ServerLevel level;
    private final PriorityQueue<ScheduledTick<Block>> pending = new PriorityQueue<>(ScheduledTick.DRAIN_ORDER);
    private final Set<Key> scheduled = new HashSet<>();
    private final Set<Key> thisStep = new HashSet<>();
    private final ArrayDeque<ScheduledTick<Block>> executing = new ArrayDeque<>();
    private ParallelWireNetworks wires;
    private boolean enabled, bypass, saving;
    private int speed = 1, workers = 1;
    private double budgetMs = 12;
    private long clock, realAnchor, beganNanos, logicalSteps, blockTicks, budgetHits;
    private long sampleNanos, sampleSteps;
    private double measuredTps, lastWorkMs, maxWorkMs;
    private String error;

    public RedstoneEngine(ServerLevel level) {
        this.level = level; clock = realAnchor = level.getGameTime();
        LEVELS.put(level, this); QUEUES.put(level.getBlockTicks(), this);
    }
    public static RedstoneEngine get(Level level) { return level instanceof ServerLevel server ? LEVELS.get(server) : null; }
    public static RedstoneEngine get(LevelTicks<?> ticks) { return QUEUES.get(ticks); }
    public static long time(Level level) {
        RedstoneEngine engine = get(level);
        return engine == null ? level.getGameTime() : engine.logicalTime();
    }
    public static void settle(Level level) {
        var engine = get(level);
        if (engine != null && engine.enabled()) engine.flushWires();
    }
    private long logicalTime() { return enabled ? clock : clock + level.getGameTime() - realAnchor; }
    public boolean enabled() { return enabled && !saving; }

    static boolean supported(Block block) {
        return block instanceof DiodeBlock || block instanceof RedstoneTorchBlock || block instanceof RedstoneLampBlock
                || block instanceof ButtonBlock || block instanceof ObserverBlock;
    }

    public void configure(int speed, int workers, double budgetMs, boolean optimizeWires) {
        if (speed < 1 || speed > 256 || workers < 1 || workers > 16 || !Double.isFinite(budgetMs) || budgetMs < 1 || budgetMs > 40)
            throw new IllegalArgumentException("Use speed 1..256, workers 1..16 and budgetMs 1..40");
        disable(); this.speed = speed; this.workers = workers; this.budgetMs = budgetMs;
        clock = logicalTime(); realAnchor = level.getGameTime();
        enabled = true; error = null;
        wires = optimizeWires ? new ParallelWireNetworks(level, workers) : null;
        beganNanos = sampleNanos = System.nanoTime(); logicalSteps = sampleSteps = blockTicks = budgetHits = 0;
        measuredTps = lastWorkMs = maxWorkMs = 0;
        importPending();
    }

    public void disable() {
        if (!enabled) return;
        flushWires(); exportPending(null);
        enabled = false; realAnchor = level.getGameTime();
        if (wires != null) { wires.close(); wires = null; }
    }

    /** Called by the native queue hook only; preserves the caller's delay and priority. */
    public boolean schedule(ScheduledTick<?> tick) {
        if (!enabled() || bypass || !(tick.type() instanceof Block block) || !supported(block)) return false;
        enqueue(new ScheduledTick<>(block, tick.pos(), clock + Math.max(0, tick.triggerTick() - level.getGameTime()), tick.priority(), tick.subTickOrder()));
        return true;
    }
    private void enqueue(ScheduledTick<Block> tick) {
        if (scheduled.add(new Key(tick.pos(), tick.type()))) pending.add(tick);
    }
    public boolean has(BlockPos pos, Object type) { return type instanceof Block block && scheduled.contains(new Key(pos, block)); }
    public boolean willTick(BlockPos pos, Object type) { return type instanceof Block block && thisStep.contains(new Key(pos, block)); }
    public boolean dirty(BlockPos pos) { return enabled() && wires != null && wires.dirty(pos); }
    public void changed(BlockState before, BlockState after) { if (enabled() && wires != null) wires.invalidate(before, after); }
    private void flushWires() { if (wires != null) wires.flush(); }

    private void importPending() {
        if (!enabled()) return;
        var access = (LevelTicksAccessor) level.getBlockTicks();
        for (var entry : access.mcengineer$containers().long2ObjectEntrySet()) {
            var container = entry.getValue();
            List<ScheduledTick<Block>> redstone = container.getAll().filter(tick -> supported(tick.type())).toList();
            if (redstone.isEmpty()) continue;
            container.removeIf(tick -> supported(tick.type()));
            ScheduledTick<Block> next = container.peek();
            if (next == null) access.mcengineer$nextTicks().remove(entry.getLongKey());
            else access.mcengineer$nextTicks().put(entry.getLongKey(), next.triggerTick());
            for (var tick : redstone) schedule(tick);
        }
    }

    private void exportPending(Long chunk) {
        bypass = true;
        try {
            var keep = new ArrayList<ScheduledTick<Block>>();
            while (!pending.isEmpty()) {
                var tick = pending.remove();
                if (chunk != null && ChunkPos.asLong(tick.pos()) != chunk.longValue()) { keep.add(tick); continue; }
                scheduled.remove(new Key(tick.pos(), tick.type()));
                level.getBlockTicks().schedule(new ScheduledTick<>(tick.type(), tick.pos(),
                        level.getGameTime() + Math.max(0, tick.triggerTick() - clock), tick.priority(), tick.subTickOrder()));
            }
            pending.addAll(keep);
        } finally { bypass = false; }
    }

    public void beforeSave() {
        if (!enabled) return;
        flushWires(); exportPending(null); saving = true;
    }
    public void afterSave() { if (saving) { saving = false; importPending(); } }
    public void beforeUnload(long chunk) {
        if (enabled) exportPending(chunk);
        if (wires != null) wires.unload(chunk);
    }

    /** Each complete substep is atomic with respect to world writes and test sampling. */
    public void tick(Runnable sampleCircuit) {
        if (!enabled()) return;
        long start = System.nanoTime();
        try {
            importPending(); flushWires();
            for (int step = 0; step < speed; step++) {
                clock++; logicalSteps++;
                var due = new ArrayList<ScheduledTick<Block>>();
                var asleep = new ArrayList<ScheduledTick<Block>>();
                while (!pending.isEmpty() && pending.peek().triggerTick() <= clock) {
                    var tick = pending.remove();
                    if (!level.shouldTickBlocksAt(ChunkPos.asLong(tick.pos()))) { asleep.add(tick); continue; }
                    due.add(tick); thisStep.add(new Key(tick.pos(), tick.type()));
                }
                pending.addAll(asleep);
                due.sort(ScheduledTick.INTRA_TICK_DRAIN_ORDER);
                executing.addAll(due);
                while (!executing.isEmpty()) {
                    var tick = executing.removeFirst();
                    Key key = new Key(tick.pos(), tick.type());
                    scheduled.remove(key); thisStep.remove(key);
                    BlockState state = level.getBlockState(tick.pos());
                    if (state.is(tick.type())) { state.tick(level, tick.pos(), level.random); blockTicks++; }
                    flushWires();
                }
                sampleCircuit.run(); flushWires();
                if (System.nanoTime() - start >= budgetMs * 1_000_000) { budgetHits++; break; }
            }
        } catch (RuntimeException exception) {
            error = exception.toString();
            McArchitectMod.LOGGER.error("Redstone acceleration stopped", exception);
            // Pending native component events must survive a failed optimized calculation.
            if (wires != null) { wires.close(); wires = null; }
            pending.addAll(executing); executing.clear();
            disable();
        } finally {
            thisStep.clear(); lastWorkMs = (System.nanoTime() - start) / 1_000_000.0;
            maxWorkMs = Math.max(maxWorkMs, lastWorkMs);
            long now = System.nanoTime();
            if (now - sampleNanos >= 1_000_000_000L) {
                measuredTps = (logicalSteps - sampleSteps) * 1_000_000_000.0 / (now - sampleNanos);
                sampleSteps = logicalSteps; sampleNanos = now;
            }
        }
    }

    public Map<String, Object> status() {
        var result = new LinkedHashMap<String, Object>();
        result.put("enabled", enabled()); result.put("dimension", level.dimension().identifier().toString());
        result.put("speed", speed); result.put("workers", workers); result.put("budgetMs", budgetMs);
        result.put("worldTickRate", level.getServer().tickRateManager().tickrate());
        result.put("worldTick", level.getGameTime());
        result.put("redstoneTick", logicalTime()); result.put("redstoneTicksPerSecond", measuredTps);
        result.put("simulatedTicks", logicalSteps); result.put("componentTicks", blockTicks);
        result.put("pendingComponentTicks", pending.size()); result.put("budgetHits", budgetHits);
        result.put("lastWorkMs", lastWorkMs); result.put("maxWorkMs", maxWorkMs);
        result.put("wireOptimization", wires != null); if (wires != null) result.put("networks", wires.status());
        result.put("timing", "Redstone substeps; entities, fluids and world time retain normal game ticks");
        result.put("compatibility", "Opt-in; wire batching may differ for update-order-dependent circuits. Pistons and other actuators remain on world ticks.");
        if (error != null) result.put("error", error);
        return result;
    }
    @Override public void close() {
        disable(); LEVELS.remove(level); QUEUES.remove(level.getBlockTicks());
    }
}
