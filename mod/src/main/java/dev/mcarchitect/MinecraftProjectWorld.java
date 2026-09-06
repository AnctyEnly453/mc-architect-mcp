package dev.mcarchitect;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.function.Supplier;
import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.level.TicketType;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraft.world.phys.AABB;

final class MinecraftProjectWorld implements ProjectWorld {
    // No PERSIST flag: these tickets never become permanent /forceload entries.
    private static final TicketType BUILD_TICKET = new TicketType(TicketType.NO_TIMEOUT,
            TicketType.FLAG_LOADING | TicketType.FLAG_KEEP_DIMENSION_ACTIVE);
    private static final int LOAD_RADIUS = 1;
    private final MinecraftServer server;
    private final Supplier<ServerPlayer> player;
    private final Map<String, BlockState> parsed = new HashMap<>();
    private final Map<BlockState, String> strings = new IdentityHashMap<>();
    private ServerLevel level;

    MinecraftProjectWorld(MinecraftServer server, Supplier<ServerPlayer> player) { this.server = server; this.player = player; }
    static String identity(MinecraftServer server) {
        String path = server.getWorldPath(LevelResource.ROOT).toAbsolutePath().normalize().toString();
        return UUID.nameUUIDFromBytes(path.getBytes(StandardCharsets.UTF_8)).toString();
    }
    @Override public String worldId() { return identity(server); }
    @Override public String dimension() { return player.get().level().dimension().identifier().toString(); }
    @Override public void bindDimension(String dimension) {
        for (ServerLevel candidate : server.getAllLevels()) {
            if (candidate.dimension().identifier().toString().equals(dimension)) { level = candidate; return; }
        }
        throw new IllegalArgumentException("Project dimension is unavailable");
    }
    @Override public String canonical(String specification) {
        BlockState state = parsed.computeIfAbsent(specification, ArchitectHttpServer::parseBlockState);
        if (state.hasBlockEntity() && !state.is(Blocks.COMPARATOR)) throw new IllegalArgumentException("Block entity placement is not supported: " + specification);
        String canonical = strings.computeIfAbsent(state, ArchitectHttpServer::stateString);
        parsed.putIfAbsent(canonical, state);
        return canonical;
    }
    @Override public void validateHeight(int minY, int maxY) {
        if (minY < level.getMinY() || maxY >= level.getMaxY()) throw new IllegalArgumentException("Section is outside world build height");
    }
    @Override public CompletableFuture<?> loadChunk(int x, int z) {
        return level.getChunkSource().addTicketAndLoadWithRadius(BUILD_TICKET, new ChunkPos(x, z), LOAD_RADIUS);
    }
    @Override public void releaseChunk(int x, int z) {
        level.getChunkSource().removeTicketWithRadius(BUILD_TICKET, new ChunkPos(x, z), LOAD_RADIUS);
    }
    @Override public String read(int x, int y, int z) {
        BlockState state = level.getBlockState(new BlockPos(x, y, z));
        String canonical = strings.computeIfAbsent(state, ArchitectHttpServer::stateString);
        parsed.putIfAbsent(canonical, state);
        return canonical;
    }
    @Override public void checkWritable(int x, int y, int z) {
        BlockPos pos = new BlockPos(x, y, z);
        // Comparator entities only hold derived signal strength; containers and user NBT remain protected.
        if (!level.getBlockState(pos).is(Blocks.COMPARATOR)
                && (level.getBlockEntity(pos) != null || level.getBlockState(pos).hasBlockEntity())) {
            throw new IllegalStateException("Protected block entity at " + pos.toShortString());
        }
        AABB box = new AABB(pos);
        for (ServerPlayer other : level.players()) {
            if (other.getBoundingBox().intersects(box)) throw new IllegalStateException("Player entered work area at " + pos.toShortString());
        }
    }
    @Override public void write(int x, int y, int z, String specification) {
        BlockPos pos = new BlockPos(x, y, z);
        BlockState state = parsed.computeIfAbsent(specification, ArchitectHttpServer::parseBlockState);
        if (!level.setBlock(pos, state, 3) && level.getBlockState(pos) != state) {
            throw new IllegalStateException("Minecraft rejected block change at " + pos.toShortString());
        }
    }
}
