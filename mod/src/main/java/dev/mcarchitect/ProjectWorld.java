package dev.mcarchitect;

import java.util.concurrent.CompletableFuture;

/** All methods run on the server thread. Loading must return without waiting. */
interface ProjectWorld {
    String worldId();
    String dimension();
    default void bindDimension(String dimension) {
        if (!dimension().equals(dimension)) throw new IllegalArgumentException("Wrong dimension");
    }
    String canonical(String specification);
    void validateHeight(int minY, int maxY);
    CompletableFuture<?> loadChunk(int x, int z);
    void releaseChunk(int x, int z);
    String read(int x, int y, int z);
    void checkWritable(int x, int y, int z);
    void write(int x, int y, int z, String state);
}
