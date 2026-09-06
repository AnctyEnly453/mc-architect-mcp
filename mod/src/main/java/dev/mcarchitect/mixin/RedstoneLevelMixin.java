package dev.mcarchitect.mixin;

import dev.mcarchitect.RedstoneEngine;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(Level.class)
abstract class RedstoneLevelMixin {
    @Inject(method = "setBlock(Lnet/minecraft/core/BlockPos;Lnet/minecraft/world/level/block/state/BlockState;II)Z", at = @At("HEAD"))
    private void mcengineer$invalidate(BlockPos pos, BlockState state, int flags, int recursion, CallbackInfoReturnable<Boolean> ci) {
        Level level = (Level)(Object)this;
        var engine = RedstoneEngine.get(level);
        if (engine != null && engine.enabled()) engine.changed(level.getBlockState(pos), state);
    }
}
