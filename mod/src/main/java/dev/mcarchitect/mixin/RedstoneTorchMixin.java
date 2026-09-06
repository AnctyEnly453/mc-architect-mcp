package dev.mcarchitect.mixin;

import dev.mcarchitect.RedstoneEngine;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.RedstoneTorchBlock;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

@Mixin(RedstoneTorchBlock.class)
abstract class RedstoneTorchMixin {
    @Redirect(method = "tick", at = @At(value = "INVOKE", target = "Lnet/minecraft/server/level/ServerLevel;getGameTime()J"))
    private long mcengineer$cooldown(ServerLevel level) { return RedstoneEngine.time(level); }
    @Redirect(method = "isToggledTooFrequently", at = @At(value = "INVOKE", target = "Lnet/minecraft/world/level/Level;getGameTime()J"))
    private static long mcengineer$toggleTime(Level level) { return RedstoneEngine.time(level); }
}
