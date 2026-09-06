package dev.mcarchitect.mixin;

import dev.mcarchitect.McArchitectClient;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.renderer.GameRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(GameRenderer.class)
abstract class GameRendererMixin {
    @Inject(method="render",at=@At("RETURN"))
    private void mcarchitect$captureGuiFrame(DeltaTracker deltaTracker,boolean renderLevel,CallbackInfo ci) { McArchitectClient.capturePendingGuiFrame(); }
    @Inject(
            method = "render",
            at = @At(
                    value = "INVOKE",
                    target = "Lnet/minecraft/client/renderer/fog/FogRenderer;endFrame()V",
                    shift = At.Shift.BEFORE
            )
    )
    private void mcarchitect$captureCleanWorldFrame(
            DeltaTracker deltaTracker,
            boolean renderLevel,
            CallbackInfo callbackInfo
    ) {
        McArchitectClient.capturePendingWorldFrame();
    }
}
