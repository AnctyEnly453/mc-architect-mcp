package dev.mcarchitect;

import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.network.chat.Component;
import net.minecraft.world.level.storage.LevelSummary;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

final class ArchitectClientController {
    private static final DateTimeFormatter SCREENSHOT_NAME =
            DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss-SSS").withZone(ZoneOffset.UTC);
    private static ArchitectClientController instance;

    private final Minecraft minecraft;
    private final AtomicReference<ScreenshotRequest> pendingScreenshot = new AtomicReference<>();

    private ArchitectClientController(Minecraft minecraft) {
        this.minecraft = minecraft;
    }

    static void initialize() {
        instance = new ArchitectClientController(Minecraft.getInstance());
    }

    static ArchitectClientController get() {
        if (instance == null) {
            throw new ClientControlException(503, "Minecraft client is not ready");
        }
        return instance;
    }

    Map<String, Object> uiState() {
        return onClient(() -> Map.of(
                "screen", minecraft.screen == null ? "in_game" : minecraft.screen.getClass().getSimpleName(),
                "worldOpen", minecraft.level != null,
                "localServerRunning", minecraft.hasSingleplayerServer()
        ));
    }

    List<Map<String, Object>> listWorlds() {
        if (minecraft.level != null) {
            throw new ClientControlException(409, "Exit the current world before listing saves");
        }
        try {
            var source = minecraft.getLevelSource();
            var candidates = source.findLevelCandidates();
            return source.loadLevelSummaries(candidates).get(20, TimeUnit.SECONDS).stream()
                    .sorted(Comparator.comparingLong(LevelSummary::getLastPlayed).reversed())
                    .map(ArchitectClientController::summaryJson)
                    .toList();
        } catch (Exception exception) {
            throw new ClientControlException(500, "Unable to read single-player saves", exception);
        }
    }

    Map<String, Object> openWorld(String levelId) {
        if (levelId == null || levelId.isBlank()) {
            throw new ClientControlException(400, "levelId is required");
        }
        if (minecraft.level != null) {
            throw new ClientControlException(409, "A world is already open");
        }
        boolean exists = listWorlds().stream().anyMatch(world -> levelId.equals(world.get("levelId")));
        if (!exists) {
            throw new ClientControlException(404, "Unknown single-player save: " + levelId);
        }

        minecraft.execute(() -> minecraft.createWorldOpenFlows().openWorld(
                levelId,
                () -> McArchitectMod.LOGGER.warn("Opening world {} was cancelled or failed", levelId)
        ));
        return Map.of("accepted", true, "levelId", levelId);
    }

    Map<String, Object> disconnect() {
        if (minecraft.level == null) {
            return Map.of("accepted", false, "message", "No world is open");
        }
        minecraft.execute(() -> minecraft.disconnectFromWorld(Component.translatable("menu.savingLevel")));
        return Map.of("accepted", true, "message", "Saving and returning to the title screen");
    }

    Map<String, Object> captureScreenshot() {
        String filename = SCREENSHOT_NAME.format(Instant.now()) + ".png";
        Path target = minecraft.gameDirectory.toPath().resolve("screenshots").resolve(filename);
        CompletableFuture<Map<String, Object>> captured = new CompletableFuture<>();
        ScreenshotRequest request = new ScreenshotRequest(
                filename,
                target,
                minecraft.screen == null ? "in_game" : minecraft.screen.getClass().getSimpleName(),
                captured
        );
        if (!pendingScreenshot.compareAndSet(null, request)) {
            throw new ClientControlException(409, "Another clean screenshot is already pending");
        }
        try {
            return captured.get(12, TimeUnit.SECONDS);
        } catch (Exception exception) {
            pendingScreenshot.compareAndSet(request, null);
            throw new ClientControlException(500, "Unable to capture Minecraft screenshot", exception);
        }
    }

    int fov() {
        return onClient(() -> minecraft.options.fov().get());
    }

    void setFov(int fov) {
        onClient(() -> {
            minecraft.options.fov().set(fov);
            return null;
        });
    }

    void capturePendingWorldFrame() {
        ScreenshotRequest request = pendingScreenshot.getAndSet(null);
        if (request == null) return;

        Screenshot.grab(
                minecraft.gameDirectory,
                request.filename,
                minecraft.getMainRenderTarget(),
                1,
                message -> request.result.complete(Map.of(
                        "path", request.target.toAbsolutePath().toString(),
                        "mediaType", "image/png",
                        "screen", request.screen,
                        "cleanWorldFrame", true
                ))
        );
    }

    private <T> T onClient(java.util.function.Supplier<T> action) {
        if (minecraft.isSameThread()) {
            return action.get();
        }
        CompletableFuture<T> future = new CompletableFuture<>();
        minecraft.execute(() -> {
            try {
                future.complete(action.get());
            } catch (Throwable throwable) {
                future.completeExceptionally(throwable);
            }
        });
        try {
            return future.get(12, TimeUnit.SECONDS);
        } catch (Exception exception) {
            if (exception.getCause() instanceof ClientControlException clientException) {
                throw clientException;
            }
            throw new ClientControlException(500, "Minecraft client did not complete the operation", exception);
        }
    }

    private static Map<String, Object> summaryJson(LevelSummary summary) {
        return Map.of(
                "levelId", summary.getLevelId(),
                "name", summary.getLevelName(),
                "lastPlayed", summary.getLastPlayed(),
                "gameMode", summary.getGameMode().getName(),
                "hardcore", summary.isHardcore(),
                "locked", summary.isLocked(),
                "compatible", summary.isCompatible(),
                "requiresBackup", summary.shouldBackup()
        );
    }

    private record ScreenshotRequest(String filename, Path target, String screen,
                                     CompletableFuture<Map<String, Object>> result) {}

    static final class ClientControlException extends RuntimeException {
        final int status;

        ClientControlException(int status, String message) {
            super(message);
            this.status = status;
        }

        ClientControlException(int status, String message, Throwable cause) {
            super(message, cause);
            this.status = status;
        }
    }
}
