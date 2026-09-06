package dev.mcarchitect;

import net.fabricmc.api.ClientModInitializer;

public final class McArchitectClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        ArchitectClientController.initialize();
        var key=net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper.registerKeyBinding(new net.minecraft.client.KeyMapping("key.mcarchitect.keyboard",org.lwjgl.glfw.GLFW.GLFW_KEY_F8,net.minecraft.client.KeyMapping.Category.MISC));
        net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents.END_CLIENT_TICK.register(client->{
            while(key.consumeClick()) if(client.level!=null && client.screen==null) ComputerKeyboardScreen.open(false,true);
        });
    }

    public static void capturePendingWorldFrame() {
        ArchitectClientController.get().capturePendingWorldFrame();
    }
    public static void capturePendingGuiFrame() { ArchitectClientController.get().capturePendingGuiFrame(); }
    public static double[] cinematicCameraPose() { return ArchitectClientController.get().cameraPose(); }
}
