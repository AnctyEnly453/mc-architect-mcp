package dev.mcarchitect;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.minecraft.server.MinecraftServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class McArchitectMod implements ModInitializer {
    public static final String MOD_ID = "mcarchitect";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    private ArchitectHttpServer httpServer;

    @Override
    public void onInitialize() {
        var config = ArchitectConfig.load();
        httpServer = new ArchitectHttpServer(config);
        httpServer.start();

        ServerLifecycleEvents.SERVER_STARTED.register(httpServer::setMinecraftServer);
        ServerLifecycleEvents.SERVER_STOPPED.register(server -> httpServer.setMinecraftServer(null));
        ServerTickEvents.END_SERVER_TICK.register(httpServer::tick);
    }
}
