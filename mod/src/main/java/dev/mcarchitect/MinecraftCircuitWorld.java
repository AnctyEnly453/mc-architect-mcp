package dev.mcarchitect;

import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.function.Supplier;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.level.TicketType;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.block.LeverBlock;
import net.minecraft.world.level.block.ButtonBlock;
import net.minecraft.world.level.block.FaceAttachedHorizontalDirectionalBlock;
import net.minecraft.world.level.block.RedStoneWireBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.redstone.ExperimentalRedstoneUtils;

final class MinecraftCircuitWorld implements CircuitWorld {
    private static final TicketType TEST_TICKET = new TicketType(TicketType.NO_TIMEOUT,
            TicketType.FLAG_LOADING | TicketType.FLAG_SIMULATION | TicketType.FLAG_KEEP_DIMENSION_ACTIVE);
    private final MinecraftServer server;
    private final Supplier<ServerPlayer> player;
    private final Set<ChunkPos> tickets = new HashSet<>();
    private ServerLevel level;
    MinecraftCircuitWorld(MinecraftServer server, Supplier<ServerPlayer> player) { this.server = server; this.player = player; }
    @Override public String worldId() { return MinecraftProjectWorld.identity(server); }
    @Override public String dimension() { return player.get().level().dimension().identifier().toString(); }
    @Override public long gameTick() { return RedstoneEngine.time(level); }
    @Override public CompletableFuture<?> load(CircuitTestService.Spec spec) {
        release(); level = player.get().level();
        if (!level.dimension().identifier().toString().equals(spec.dimension())) throw new IllegalArgumentException("Circuit dimension changed");
        var bounds = spec.bounds();
        if (bounds.from().y() < level.getMinY() || bounds.to().y() >= level.getMaxY()) throw new IllegalArgumentException("Test region outside world height");
        var futures = new ArrayList<CompletableFuture<?>>();
        for (int z = Math.floorDiv(bounds.from().z(), 16); z <= Math.floorDiv(bounds.to().z(), 16); z++) {
            for (int x = Math.floorDiv(bounds.from().x(), 16); x <= Math.floorDiv(bounds.to().x(), 16); x++) {
                var chunk = new ChunkPos(x, z); tickets.add(chunk);
                futures.add(level.getChunkSource().addTicketAndLoadWithRadius(TEST_TICKET, chunk, 2));
            }
        }
        return CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new));
    }
    @Override public void release() {
        if (level != null) for (var chunk : tickets) level.getChunkSource().removeTicketWithRadius(TEST_TICKET, chunk, 2);
        tickets.clear();
    }
    private BlockPos pos(CircuitTestService.Point p) { return new BlockPos(p.x(), p.y(), p.z()); }
    private BlockState control(CircuitTestService.Input input) {
        BlockState state = level.getBlockState(pos(input.position()));
        if (!(state.getBlock() instanceof LeverBlock) && !(state.getBlock() instanceof ButtonBlock))
            throw new IllegalStateException("Input " + input.id() + " must target an existing lever or button");
        return state;
    }
    @Override public String inputState(CircuitTestService.Input input) { return ArchitectHttpServer.stateString(control(input)); }
    @Override public void drive(CircuitTestService.Input input, boolean value, String before) {
        BlockState current = control(input), original = ArchitectHttpServer.parseBlockState(before);
        if (current.setValue(LeverBlock.POWERED, false) != original.setValue(LeverBlock.POWERED, false)) {
            throw new IllegalStateException("Input structure changed at " + input.id());
        }
        if (current.getValue(LeverBlock.POWERED) == value) return;
        BlockPos position = pos(input.position());
        if (current.getBlock() instanceof LeverBlock lever) {
            lever.pull(current, level, position, player.get());
        } else if (value) {
            // Vanilla schedules the release: a button event is a click, not a held lever.
            ((ButtonBlock) current.getBlock()).press(current, level, position, player.get());
        } else {
            level.setBlock(position, current.setValue(ButtonBlock.POWERED, false), 3);
            Direction support = switch (current.getValue(FaceAttachedHorizontalDirectionalBlock.FACE)) {
                case FLOOR -> Direction.DOWN;
                case CEILING -> Direction.UP;
                case WALL -> current.getValue(ButtonBlock.FACING).getOpposite();
            };
            var orientation = ExperimentalRedstoneUtils.initialOrientation(level, support,
                    support.getAxis().isHorizontal() ? Direction.UP : current.getValue(ButtonBlock.FACING));
            level.updateNeighborsAt(position, current.getBlock(), orientation);
            level.updateNeighborsAt(position.relative(support), current.getBlock(), orientation);
        }
        RedstoneEngine.settle(level);
    }
    @Override public void restore(CircuitTestService.Input input, String before) {
        var original = ArchitectHttpServer.parseBlockState(before); drive(input, original.getValue(LeverBlock.POWERED), before);
    }
    @Override public int sample(CircuitTestService.Probe probe) {
        BlockPos position = pos(probe.position()); BlockState state = level.getBlockState(position);
        if (probe.face().equals("received")) return level.getBestNeighborSignal(position);
        if (probe.face().equals("wire")) {
            if (!(state.getBlock() instanceof RedStoneWireBlock)) throw new IllegalStateException("Wire probe " + probe.id() + " no longer targets redstone dust");
            return state.getValue(RedStoneWireBlock.POWER);
        }
        return state.getSignal(level, position, Objects.requireNonNull(Direction.byName(probe.face())));
    }
}
