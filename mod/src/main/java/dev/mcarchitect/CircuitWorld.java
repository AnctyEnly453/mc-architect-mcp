package dev.mcarchitect;

import java.util.concurrent.CompletableFuture;

interface CircuitWorld {
    String worldId();
    String dimension();
    long gameTick();
    CompletableFuture<?> load(CircuitTestService.Spec spec);
    void release();
    String inputState(CircuitTestService.Input input);
    void drive(CircuitTestService.Input input, boolean value, String before);
    void restore(CircuitTestService.Input input, String before);
    int sample(CircuitTestService.Probe probe);
}
