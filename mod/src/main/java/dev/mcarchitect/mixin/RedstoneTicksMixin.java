package dev.mcarchitect.mixin;

import dev.mcarchitect.RedstoneEngine;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.ticks.LevelTicks;
import net.minecraft.world.ticks.ScheduledTick;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(LevelTicks.class)
abstract class RedstoneTicksMixin<T> {
    @Inject(method = "schedule", at = @At("HEAD"), cancellable = true)
    private void mcengineer$schedule(ScheduledTick<T> tick, CallbackInfo ci) {
        var engine = RedstoneEngine.get((LevelTicks<?>)(Object)this);
        if (engine != null && engine.schedule(tick)) ci.cancel();
    }
    @Inject(method = "hasScheduledTick", at = @At("HEAD"), cancellable = true)
    private void mcengineer$has(BlockPos pos, T type, CallbackInfoReturnable<Boolean> ci) {
        var engine = RedstoneEngine.get((LevelTicks<?>)(Object)this);
        if (engine != null && engine.has(pos, type)) ci.setReturnValue(true);
    }
    @Inject(method = "willTickThisTick", at = @At("HEAD"), cancellable = true)
    private void mcengineer$willTick(BlockPos pos, T type, CallbackInfoReturnable<Boolean> ci) {
        var engine = RedstoneEngine.get((LevelTicks<?>)(Object)this);
        if (engine != null && engine.willTick(pos, type)) ci.setReturnValue(true);
    }
    @Inject(method = "removeContainer", at = @At("HEAD"))
    private void mcengineer$unload(ChunkPos chunk, CallbackInfo ci) {
        var engine = RedstoneEngine.get((LevelTicks<?>)(Object)this);
        if (engine != null) engine.beforeUnload(chunk.toLong());
    }
}
