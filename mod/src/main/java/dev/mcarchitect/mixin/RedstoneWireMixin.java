package dev.mcarchitect.mixin;

import dev.mcarchitect.RedstoneEngine;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.RedStoneWireBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.redstone.Orientation;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(RedStoneWireBlock.class)
abstract class RedstoneWireMixin {
    @Inject(method = "updatePowerStrength", at = @At("HEAD"), cancellable = true)
    private void mcengineer$queue(Level level, BlockPos pos, BlockState state, Orientation orientation, boolean shape, CallbackInfo ci) {
        var engine = RedstoneEngine.get(level);
        if (engine != null && engine.dirty(pos)) ci.cancel();
    }
}
