package dev.mcarchitect;

import java.util.*;
import java.util.concurrent.*;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.RedStoneWireBlock;
import net.minecraft.world.level.block.state.BlockState;

/** World access stays on the server thread. Workers receive immutable numerical snapshots. */
final class ParallelWireNetworks implements AutoCloseable {
    private record Network(List<BlockPos> positions, int[][] outgoing) {}
    private record Job(Network network, int[] sources) {}
    private final ServerLevel level;
    private final ExecutorService workers;
    private final int workerCount;
    private final Map<Long, Network> topology = new HashMap<>();
    private final Set<Long> fallback = new HashSet<>();
    private final LinkedHashSet<Long> dirty = new LinkedHashSet<>();
    private boolean flushing;
    long solvedNetworks, solvedNodes, parallelBatches, workerJobs, changedWires, cacheBuilds;

    ParallelWireNetworks(ServerLevel level, int count) {
        this.level = level; workerCount = count;
        workers = Executors.newFixedThreadPool(count, r -> {
            var t = new Thread(r, "mcengineer-redstone-worker"); t.setDaemon(true); return t;
        });
    }

    boolean dirty(BlockPos pos) {
        if (fallback.contains(pos.asLong())) return false;
        dirty.add(pos.asLong()); return true;
    }

    void invalidate(BlockState before, BlockState after) {
        if (before.getBlock() == after.getBlock()) {
            if (!before.is(Blocks.REDSTONE_WIRE)) return;
            if (before.setValue(RedStoneWireBlock.POWER, 0) == after.setValue(RedStoneWireBlock.POWER, 0)) return;
        }
        topology.clear(); fallback.clear();
    }
    void unload(long chunk) {
        topology.clear(); fallback.clear();
        dirty.removeIf(pos -> net.minecraft.world.level.ChunkPos.asLong(BlockPos.of(pos)) == chunk);
    }

    private Network network(BlockPos start) {
        Network known = topology.get(start.asLong());
        if (known != null) return known;
        var seen = new LinkedHashMap<Long, BlockPos>();
        var queue = new ArrayDeque<BlockPos>(); queue.add(start);
        while (!queue.isEmpty()) {
            BlockPos pos = queue.removeFirst();
            if (seen.containsKey(pos.asLong()) || !level.hasChunkAt(pos) || !level.getBlockState(pos).is(Blocks.REDSTONE_WIRE)) continue;
            seen.put(pos.asLong(), pos);
            if (seen.size() > 8192) { fallback.addAll(seen.keySet()); return null; }
            // A superset of potential stair edges groups all mutually dependent wires.
            for (Direction direction : Direction.Plane.HORIZONTAL) {
                BlockPos adjacent = pos.relative(direction);
                queue.add(adjacent); queue.add(adjacent.above()); queue.add(adjacent.below());
            }
        }
        if (seen.isEmpty()) return null;
        var positions = List.copyOf(seen.values());
        var indices = new HashMap<Long, Integer>();
        for (int i = 0; i < positions.size(); i++) indices.put(positions.get(i).asLong(), i);
        var outgoing = new ArrayList<List<Integer>>();
        for (int i = 0; i < positions.size(); i++) outgoing.add(new ArrayList<>());
        for (int target = 0; target < positions.size(); target++) {
            BlockPos pos = positions.get(target), above = pos.above();
            boolean covered = level.getBlockState(above).isRedstoneConductor(level, above);
            for (Direction direction : Direction.Plane.HORIZONTAL) {
                BlockPos adjacent = pos.relative(direction);
                addEdge(indices, outgoing, adjacent, target);
                boolean solid = level.getBlockState(adjacent).isRedstoneConductor(level, adjacent);
                if (solid && !covered) addEdge(indices, outgoing, adjacent.above(), target);
                else if (!solid) addEdge(indices, outgoing, adjacent.below(), target);
            }
        }
        int[][] graph = outgoing.stream().map(row -> row.stream().mapToInt(Integer::intValue).toArray()).toArray(int[][]::new);
        var result = new Network(positions, graph);
        seen.keySet().forEach(key -> topology.put(key, result)); cacheBuilds++;
        return result;
    }

    private static void addEdge(Map<Long, Integer> indices, List<List<Integer>> outgoing, BlockPos source, int target) {
        Integer index = indices.get(source.asLong());
        if (index != null) outgoing.get(index).add(target);
    }

    void flush() {
        if (flushing || dirty.isEmpty()) return;
        flushing = true;
        try {
            for (int round = 0; !dirty.isEmpty(); round++) {
                if (round >= 128) throw new IllegalStateException("Wire network did not settle; disable acceleration and inspect the feedback circuit");
                var pending = new ArrayList<>(dirty); dirty.clear();
                var networks = new LinkedHashSet<Network>();
                for (long key : pending) {
                    BlockPos pos = BlockPos.of(key);
                    Network network = network(pos);
                    if (network != null) networks.add(network);
                    else if (fallback.contains(key)) {
                        // The hook now permits the vanilla evaluator for this oversized network.
                        level.updateNeighborsAt(pos, Blocks.REDSTONE_WIRE);
                    }
                }
                var jobs = new ArrayList<Job>(); int nodes = 0;
                for (Network network : networks) {
                    int[] sources = new int[network.positions.size()];
                    for (int i = 0; i < sources.length; i++)
                        sources[i] = ((RedStoneWireBlock) Blocks.REDSTONE_WIRE).getBlockSignal(level, network.positions.get(i));
                    jobs.add(new Job(network, sources)); nodes += sources.length;
                }
                var values = new int[jobs.size()][];
                if (workerCount > 1 && jobs.size() > 1 && nodes >= 256) {
                    int partitions = Math.min(workerCount, jobs.size());
                    var futures = new ArrayList<Future<?>>();
                    for (int partition = 0; partition < partitions; partition++) {
                        int lane = partition;
                        futures.add(workers.submit(() -> {
                            for (int i = lane; i < jobs.size(); i += partitions) {
                                Job job = jobs.get(i);
                                values[i] = WireNetworkSolver.solve(job.network.outgoing, job.sources);
                            }
                        }));
                    }
                    for (Future<?> future : futures) future.get();
                    parallelBatches++; workerJobs += partitions;
                } else {
                    for (int i = 0; i < jobs.size(); i++) values[i] = WireNetworkSolver.solve(jobs.get(i).network.outgoing, jobs.get(i).sources);
                }
                var notify = new LinkedHashSet<BlockPos>();
                for (int n = 0; n < jobs.size(); n++) {
                    Network network = jobs.get(n).network;
                    for (int i = 0; i < values[n].length; i++) {
                        BlockPos pos = network.positions.get(i); BlockState state = level.getBlockState(pos);
                        if (!state.is(Blocks.REDSTONE_WIRE)) { topology.clear(); continue; }
                        if (state.getValue(RedStoneWireBlock.POWER) == values[n][i]) continue;
                        level.setBlock(pos, state.setValue(RedStoneWireBlock.POWER, values[n][i]), 2);
                        changedWires++; notify.add(pos);
                        for (Direction direction : Direction.values()) notify.add(pos.relative(direction));
                    }
                }
                solvedNetworks += jobs.size(); solvedNodes += nodes;
                for (BlockPos pos : notify) level.updateNeighborsAt(pos, Blocks.REDSTONE_WIRE);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt(); throw new IllegalStateException("Parallel redstone calculation interrupted", e);
        } catch (ExecutionException e) { throw new IllegalStateException("Parallel redstone calculation failed", e.getCause()); }
        finally { flushing = false; }
    }

    Map<String, Object> status() {
        return Map.of("workers", workerCount, "cachedWireNodes", topology.size(), "cacheBuilds", cacheBuilds,
                "solvedNetworks", solvedNetworks, "solvedNodes", solvedNodes, "parallelBatches", parallelBatches,
                "workerJobs", workerJobs, "changedWires", changedWires, "pendingWireUpdates", dirty.size());
    }
    @Override public void close() { workers.shutdownNow(); topology.clear(); dirty.clear(); }
}
