package dev.mcarchitect;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.HexFormat;

public record ArchitectConfig(int port, String token) {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final int DEFAULT_PORT = 8765;

    public static ArchitectConfig load() {
        Path path = FabricLoader.getInstance().getConfigDir().resolve("mcarchitect.json");
        try {
            if (Files.exists(path)) {
                var config = GSON.fromJson(Files.readString(path, StandardCharsets.UTF_8), ArchitectConfig.class);
                if (config != null && config.port() > 0 && config.port() <= 65535
                        && config.token() != null && config.token().length() >= 32) {
                    return config;
                }
                McArchitectMod.LOGGER.warn("Invalid MC Architect config; replacing it with safe defaults");
            }

            byte[] tokenBytes = new byte[32];
            new SecureRandom().nextBytes(tokenBytes);
            var config = new ArchitectConfig(DEFAULT_PORT, HexFormat.of().formatHex(tokenBytes));
            Files.createDirectories(path.getParent());
            Files.writeString(path, GSON.toJson(config), StandardCharsets.UTF_8);
            McArchitectMod.LOGGER.info("Created MC Architect config at {}", path.toAbsolutePath());
            return config;
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to load MC Architect config", exception);
        }
    }
}
