package dev.mcarchitect.mixin;

import dev.mcarchitect.RedstoneEngine;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.ProgressListener;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ServerLevel.class)
abstract class RedstoneSaveMixin {
    @Inject(method = "save", at = @At("HEAD"))
    private void mcengineer$save(ProgressListener progress, boolean flush, boolean skip, CallbackInfo ci) {
        var engine = RedstoneEngine.get((ServerLevel)(Object)this);
        if (engine != null) engine.beforeSave();
    }
    @Inject(method = "save", at = @At("RETURN"))
    private void mcengineer$saved(ProgressListener progress, boolean flush, boolean skip, CallbackInfo ci) {
        var engine = RedstoneEngine.get((ServerLevel)(Object)this);
        if (engine != null) engine.afterSave();
    }
}
