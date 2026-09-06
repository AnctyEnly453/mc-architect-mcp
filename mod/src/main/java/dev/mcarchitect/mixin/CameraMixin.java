package dev.mcarchitect.mixin;

import dev.mcarchitect.McArchitectClient;
import net.minecraft.client.Camera;
import net.minecraft.world.level.Level;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Camera.class)
abstract class CameraMixin {
    @Shadow protected abstract void setPosition(double x,double y,double z);
    @Shadow protected abstract void setRotation(float yaw,float pitch);
    @Inject(method="setup",at=@At("RETURN"))
    private void mcarchitect$cinematicCamera(Level level,Entity entity,boolean detached,boolean mirrored,float partialTick,CallbackInfo info) {
        double[] pose=McArchitectClient.cinematicCameraPose();
        if(pose!=null) { setPosition(pose[0],pose[1],pose[2]);setRotation((float)pose[3],(float)pose[4]); }
    }
}
