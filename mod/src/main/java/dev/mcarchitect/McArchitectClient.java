package dev.mcarchitect;

import net.fabricmc.api.ClientModInitializer;

public final class McArchitectClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        ArchitectClientController.initialize();
    }

    public static void capturePendingWorldFrame() {
        ArchitectClientController.get().capturePendingWorldFrame();
    }
}
