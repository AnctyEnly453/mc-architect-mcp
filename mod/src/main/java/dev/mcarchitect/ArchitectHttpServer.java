package dev.mcarchitect;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Relative;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.LightLayer;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraft.world.phys.shapes.VoxelShape;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.HashSet;
import java.util.HashMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

final class ArchitectHttpServer {
    static volatile ArchitectHttpServer instance;
    private static final Gson GSON = new Gson();
    private static final int MAX_BODY_BYTES = 256 * 1024;
    private static final long MAX_BLOCKS = 262_144;
    private static final long MAX_SCAN_COLUMNS = 262_144;
    private static final int MAX_OPERATIONS = 256;

    private final ArchitectConfig config;
    private volatile MinecraftServer minecraftServer;
    private CameraSession cameraSession;
    private ProjectBuildService projectBuilds;
    private AssemblyBuildService assemblies;
    private CircuitTestService circuits;
    private ComputerKeyboardService keyboard;
    private final Map<ServerLevel, RedstoneEngine> redstone = new HashMap<>();
    private FilmEnvironment filmEnvironment;
    private record FilmEnvironment(ServerLevel level,long day,int clear,int rain,int thunder,boolean raining,boolean thundering) {}

    ArchitectHttpServer(ArchitectConfig config) {
        this.config = config;
        instance = this;
    }

    void start() {
        try {
            var address = new InetSocketAddress(InetAddress.getLoopbackAddress(), config.port());
            HttpServer server = HttpServer.create(address, 0);
            server.createContext("/v1/health", route("GET", false, this::health));
            server.createContext("/v1/ui", route("GET", true, this::uiState));
            server.createContext("/v1/worlds", route("GET", true, this::listWorlds));
            server.createContext("/v1/open-world", route("POST", true, this::openWorld));
            server.createContext("/v1/create-world", route("POST", true, e -> ArchitectClientController.get().createFlatWorld(readBody(e, OpenWorldRequest.class).levelId())));
            server.createContext("/v1/disconnect", route("POST", true, this::disconnect));
            server.createContext("/v1/save-world", route("POST", true, e -> onServer(() -> {
                localPlayer(); return Map.of("saved", minecraftServer.saveEverything(true, true, true));
            })));
            server.createContext("/v1/screenshot", route("POST", true, this::screenshot));
            server.createContext("/v2/video", route("POST", true, e -> {
                JsonObject request=readBody(e,JsonObject.class);
                String action=request.get("action").getAsString();
                if(action.equals("environment") || action.equals("restore-environment")) return onServer(() -> filmEnvironment(action));
                return ArchitectClientController.get().video(request);
            }));
            server.createContext("/v1/camera/begin", route("POST", true, this::beginCamera));
            server.createContext("/v1/camera/move", route("POST", true, this::moveCamera));
            server.createContext("/v1/camera/restore", route("POST", true, this::restoreCamera));
            server.createContext("/v1/tick-rate", route("POST", true, this::tickRate));
            server.createContext("/v1/context", route("GET", true, this::context));
            server.createContext("/v1/scan", route("POST", true, this::scan));
            server.createContext("/v1/access", route("POST", true, this::validateAccess));
            server.createContext("/v1/compare", route("POST", true, this::compareBlueprint));
            server.createContext("/v2/projects", route("POST", true, this::projectRequest));
            server.createContext("/v2/assemblies", route("POST", true, e -> engineRequest(e, "assembly")));
            server.createContext("/v2/circuits", route("POST", true, e -> engineRequest(e, "circuit")));
            server.createContext("/v2/redstone", route("POST", true, this::redstoneRequest));
            server.createContext("/v2/keyboard", route("POST", true, e -> {
                JsonObject request=readBody(e,JsonObject.class);
                if(request.get("action").getAsString().equals("open")) return ArchitectClientController.get().openKeyboard(request.has("demo") && request.get("demo").getAsBoolean());
                return onServer(() -> keyboardRequest(request));
            }));
            server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
            server.start();
            McArchitectMod.LOGGER.info("MC Architect listening on 127.0.0.1:{}", config.port());
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to start MC Architect HTTP server", exception);
        }
    }

    void setMinecraftServer(MinecraftServer server) {
        filmEnvironment=null;
        redstone.values().forEach(RedstoneEngine::close); redstone.clear();
        if (assemblies != null) assemblies.close();
        if (circuits != null) circuits.close();
        if (projectBuilds != null) projectBuilds.close();
        projectBuilds = null; assemblies = null; circuits = null; keyboard = null;
        CameraSession abandoned = cameraSession;
        cameraSession = null;
        if (server == null && abandoned != null) ArchitectClientController.get().setFov(abandoned.fov);
        minecraftServer = server;
        if (server != null) {
            Path root = server.getWorldPath(LevelResource.ROOT).resolve("mcarchitect");
            var store = new ProjectStore(root.resolve("projects"));
            var world = new MinecraftProjectWorld(server, this::localPlayer);
            projectBuilds = new ProjectBuildService(store, world);
            assemblies = new AssemblyBuildService(store, projectBuilds, world);
            circuits = new CircuitTestService(new MinecraftCircuitWorld(server, this::localPlayer), root.resolve("tests"));
            keyboard = new ComputerKeyboardService(circuits,server,this::localPlayer,root.resolve("keyboard.json"));
        }
    }

    void tick(MinecraftServer server) {
        if (minecraftServer != server) return;
        if (projectBuilds != null) projectBuilds.tick();
        if (assemblies != null) assemblies.tick();
        boolean sampled = false;
        for (var entry : redstone.entrySet()) if (entry.getValue().enabled()) {
            boolean matchingTest = circuits != null && circuits.inDimension(entry.getKey().dimension().identifier().toString());
            entry.getValue().tick(matchingTest ? circuits::tick : () -> {});
            sampled |= matchingTest;
        }
        if (circuits != null && !sampled) circuits.tick();
        if (keyboard != null) keyboard.tick();
    }

    private Object filmEnvironment(String action) {
        ServerLevel level=localPlayer().level();
        if(action.equals("environment")) {
            if(filmEnvironment==null) {
                var data=(net.minecraft.world.level.storage.ServerLevelData)level.getLevelData();
                filmEnvironment=new FilmEnvironment(level,level.getDayTime(),data.getClearWeatherTime(),data.getRainTime(),data.getThunderTime(),level.isRaining(),level.isThundering());
            }
            level.setDayTime(6000);level.setWeatherParameters(12000,0,false,false);
            return Map.of("presentation",true);
        }
        if(filmEnvironment!=null) {
            var saved=filmEnvironment;
            saved.level.setDayTime(saved.day);
            saved.level.setWeatherParameters(saved.clear,saved.rain,saved.raining,saved.thundering);
            ((net.minecraft.world.level.storage.ServerLevelData)saved.level.getLevelData()).setThunderTime(saved.thunder);
            filmEnvironment=null;
        }
        return Map.of("restored",true);
    }

    private Object keyboardRequest(JsonObject request) {
        if(keyboard==null) throw new IllegalStateException("请先进入世界");
        if(request.get("action").getAsString().equals("speed")) {
            keyboard.requireAvailable();
            return controlRedstone(localPlayer().level(), "configure", request.get("speed").getAsInt(), Math.min(8,Runtime.getRuntime().availableProcessors()),20,true);
        }
        if(!request.get("action").getAsString().equals("status") && (assemblies.ownsWriter() || projectBuilds.ownsWriter())) throw new IllegalStateException("请等待施工结束");
        return keyboard.request(request);
    }
    static CompletableFuture<JsonObject> keyboardFromClient(JsonObject request) {
        var future=new CompletableFuture<JsonObject>(); var host=instance;
        if(host==null || host.minecraftServer==null) return CompletableFuture.failedFuture(new IllegalStateException("请先进入单人世界"));
        host.minecraftServer.execute(()->{ try { future.complete(GSON.toJsonTree(host.keyboardRequest(request)).getAsJsonObject()); } catch(Throwable e) { future.completeExceptionally(e); } });
        return future;
    }

    private HttpHandler route(String method, boolean authenticate, ExchangeAction action) {
        return exchange -> {
            try {
                if (!method.equals(exchange.getRequestMethod())) {
                    throw new ApiException(405, "Method not allowed");
                }
                if (authenticate && !isAuthorized(exchange)) {
                    throw new ApiException(401, "Unauthorized");
                }
                writeJson(exchange, 200, action.run(exchange));
            } catch (ApiException exception) {
                writeJson(exchange, exception.status, Map.of("error", exception.getMessage()));
            } catch (ArchitectClientController.ClientControlException exception) {
                writeJson(exchange, exception.status, Map.of("error", exception.getMessage()));
            } catch (Exception exception) {
                McArchitectMod.LOGGER.error("MC Architect request failed", exception);
                writeJson(exchange, 500, Map.of("error", "Internal mod error"));
            } finally {
                exchange.close();
            }
        };
    }

    private Object health(HttpExchange ignored) {
        MinecraftServer server = minecraftServer;
        return Map.of(
                "ok", true,
                "modVersion", "0.9.1",
                "capabilities", List.of("project-stream-v1", "project-journal-recovery", "temporary-chunk-tickets", "project-guards-v1", "assembly-v1", "circuit-test-v1", "redstone-acceleration-v1", "computer-keyboard-v1"),
                "worldOpen", server != null,
                "playerAvailable", server != null && !server.getPlayerList().getPlayers().isEmpty(),
                "limits", Map.of(
                        "fullScanBlocks", MAX_BLOCKS,
                        "surfaceScanColumns", MAX_SCAN_COLUMNS,
                        "operationsPerBlueprint", MAX_OPERATIONS
                )
        );
    }

    private Object context(HttpExchange ignored) {
        return onServer(() -> {
            ServerPlayer player = localPlayer();
            return Map.of(
                    "player", player.getGameProfile().name(),
                    "worldId", MinecraftProjectWorld.identity(player.level().getServer()),
                    "position", Map.of("x", player.getX(), "y", player.getY(), "z", player.getZ()),
                    "blockPosition", positionJson(player.blockPosition()),
                    "rotation", Map.of("yaw", player.getYRot(), "pitch", player.getXRot()),
                    "dimension", player.level().dimension().identifier().toString(),
                    "gameMode", player.gameMode.getGameModeForPlayer().getName(),
                    "tickRate", minecraftServer.tickRateManager().tickrate()
            );
        });
    }

    private Object tickRate(HttpExchange exchange) {
        JsonObject request = readBody(exchange, JsonObject.class);
        float rate = request.has("rate") ? request.get("rate").getAsFloat() : Float.NaN;
        if (!Float.isFinite(rate) || rate < 1 || rate > 200) throw new ApiException(400, "Tick rate must be between 1 and 200");
        return onServer(() -> {
            localPlayer();
            minecraftServer.tickRateManager().setTickRate(rate);
            return Map.of("tickRate", minecraftServer.tickRateManager().tickrate());
        });
    }

    private Object redstoneRequest(HttpExchange exchange) {
        JsonObject request = readBody(exchange, JsonObject.class);
        return onServer(() -> {
            ServerLevel level = localPlayer().level();
            String action = request.has("action") ? request.get("action").getAsString() : "status";
            int speed = request.has("speed") ? request.get("speed").getAsInt() : 16;
            int workers = request.has("workers") ? request.get("workers").getAsInt() : Math.min(8, Math.max(1, Runtime.getRuntime().availableProcessors() - 2));
            double budget = request.has("budgetMs") ? request.get("budgetMs").getAsDouble() : 12;
            boolean optimize = !request.has("optimizeWires") || request.get("optimizeWires").getAsBoolean();
            try { return controlRedstone(level, action, speed, workers, budget, optimize); }
            catch (IllegalArgumentException error) { throw new ApiException(400, error.getMessage()); }
        });
    }

    Map<String, Object> controlRedstone(ServerLevel level, String action, int speed, int workers, double budget, boolean optimize) {
        var engine = redstone.computeIfAbsent(level, RedstoneEngine::new);
        if (action.equals("status")) return engine.status();
        if (circuits.ownsWriter()) throw new ApiException(409, "Finish or cancel the active test before changing its clock");
        if (assemblies.ownsWriter() || projectBuilds.ownsWriter()) throw new ApiException(409, "Pause construction before changing redstone acceleration");
        if (action.equals("disable")) { engine.disable(); return engine.status(); }
        if (!action.equals("configure")) throw new IllegalArgumentException("Use status, configure or disable");
        engine.configure(speed, workers, budget, optimize);
        return engine.status();
    }

    private Object uiState(HttpExchange ignored) {
        return ArchitectClientController.get().uiState();
    }

    private Object listWorlds(HttpExchange ignored) {
        return Map.of("worlds", ArchitectClientController.get().listWorlds());
    }

    private Object openWorld(HttpExchange exchange) {
        OpenWorldRequest request = readBody(exchange, OpenWorldRequest.class);
        return ArchitectClientController.get().openWorld(request.levelId);
    }

    private Object disconnect(HttpExchange ignored) {
        return ArchitectClientController.get().disconnect();
    }

    private Object screenshot(HttpExchange ignored) {
        JsonObject request=readBody(ignored,JsonObject.class);
        return ArchitectClientController.get().captureScreenshot(request.has("includeUI") && request.get("includeUI").getAsBoolean());
    }

    private Object beginCamera(HttpExchange exchange) {
        CameraBeginRequest request = readOptionalBody(exchange, CameraBeginRequest.class)
                .orElse(new CameraBeginRequest());
        return onServer(() -> {
            if (cameraSession != null) {
                throw new ApiException(409, "A camera session is already active; restore it first");
            }
            ServerPlayer player = localPlayer();
            cameraSession = new CameraSession(
                    player.level().dimension().identifier().toString(),
                    player.getX(), player.getY(), player.getZ(),
                    player.getYRot(), player.getXRot(), player.gameMode(),
                    ArchitectClientController.get().fov()
            );
            if (request.spectator == null || request.spectator) {
                player.setGameMode(GameType.SPECTATOR);
            }
            return cameraState(player, ArchitectClientController.get().fov(), true);
        });
    }

    private Object moveCamera(HttpExchange exchange) {
        CameraMoveRequest request = readBody(exchange, CameraMoveRequest.class);
        return onServer(() -> {
            if (cameraSession == null) {
                throw new ApiException(409, "No camera session is active; call camera begin first");
            }
            ServerPlayer player = localPlayer();
            if (request.position != null
                    && (request.position.x == null || request.position.y == null || request.position.z == null)) {
                throw new ApiException(400, "Camera position requires x, y, and z");
            }
            double x = request.position == null ? player.getX() : request.position.x;
            double y = request.position == null ? player.getY() : request.position.y;
            double z = request.position == null ? player.getZ() : request.position.z;
            float yaw = request.yaw == null ? player.getYRot() : request.yaw;
            float pitch = request.pitch == null ? player.getXRot() : request.pitch;
            int fov = request.fov == null ? ArchitectClientController.get().fov() : request.fov;
            if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)
                    || !Float.isFinite(yaw) || !Float.isFinite(pitch)) {
                throw new ApiException(400, "Camera position and rotation must be finite numbers");
            }
            if (y < player.level().getMinY() || y >= player.level().getMaxY()) {
                throw new ApiException(400, "Camera position is outside the world's build height");
            }
            if (fov < 30 || fov > 110) throw new ApiException(400, "fov must be between 30 and 110");
            pitch = Math.max(-90.0f, Math.min(90.0f, pitch));
            if (!player.teleportTo((ServerLevel) player.level(), x, y, z, Set.<Relative>of(), yaw, pitch, true)) {
                throw new ApiException(409, "Minecraft rejected the camera teleport");
            }
            ArchitectClientController.get().setFov(fov);
            return cameraState(player, fov, true);
        });
    }

    private Object restoreCamera(HttpExchange ignored) {
        return onServer(() -> {
            CameraSession session = cameraSession;
            if (session == null) return Map.of("restored", false, "message", "No camera session is active");
            ServerLevel level = findLevel(session.dimension);
            ServerPlayer player = localPlayer();
            if (!player.teleportTo(level, session.x, session.y, session.z, Set.<Relative>of(),
                    session.yaw, session.pitch, true)) {
                throw new ApiException(409, "Minecraft rejected the camera restore teleport");
            }
            player.setGameMode(session.gameMode);
            ArchitectClientController.get().setFov(session.fov);
            cameraSession = null;
            var result = new LinkedHashMap<String, Object>(cameraState(player, session.fov, false));
            result.put("restored", true);
            return result;
        });
    }

    private static Map<String, Object> cameraState(ServerPlayer player, int fov, boolean active) {
        return Map.of(
                "active", active,
                "position", Map.of("x", player.getX(), "y", player.getY(), "z", player.getZ()),
                "rotation", Map.of("yaw", player.getYRot(), "pitch", player.getXRot()),
                "dimension", player.level().dimension().identifier().toString(),
                "gameMode", player.gameMode().getName(),
                "fov", fov
        );
    }

    private Object scan(HttpExchange exchange) {
        RegionRequest request = readBody(exchange, RegionRequest.class);
        if (request.from == null || request.to == null) {
            throw new ApiException(400, "from and to are required");
        }
        return onServer(() -> scanRegion(request));
    }

    private Object scanRegion(RegionRequest request) {
        ServerPlayer player = localPlayer();
        ServerLevel level = player.level();
        Bounds bounds = bounds(request.from, request.to);
        validateBuildHeight(level, bounds);
        String mode = request.mode == null || request.mode.isBlank() ? "full" : request.mode;
        return switch (mode) {
            case "full" -> scanFullRegion(level, bounds);
            case "heightmap" -> heightmapResponse(scanSurface(level, bounds));
            case "summary" -> summaryResponse(scanSurface(level, bounds));
            case "collision" -> scanCollisionRegion(level, bounds);
            case "lighting" -> scanLightingRegion(level, bounds);
            default -> throw new ApiException(400,
                    "mode must be one of: heightmap, summary, collision, lighting, full");
        };
    }

    private Object scanFullRegion(ServerLevel level, Bounds bounds) {
        validateVolume(bounds, MAX_BLOCKS, "Scan exceeds the 262,144 block limit");

        var paletteIndexes = new LinkedHashMap<String, Integer>();
        var runs = new ArrayList<Map<String, Integer>>();
        int previousIndex = -1;
        int runLength = 0;
        for (int y = bounds.min.getY(); y <= bounds.max.getY(); y++) {
            for (int z = bounds.min.getZ(); z <= bounds.max.getZ(); z++) {
                for (int x = bounds.min.getX(); x <= bounds.max.getX(); x++) {
                    BlockPos pos = new BlockPos(x, y, z);
                    if (!level.hasChunkAt(pos)) {
                        throw new ApiException(409, "Scan touches an unloaded chunk at " + pos.toShortString());
                    }
                    String state = stateString(level.getBlockState(pos));
                    int index = paletteIndexes.computeIfAbsent(state, ignored -> paletteIndexes.size());
                    if (index == previousIndex) {
                        runLength++;
                    } else {
                        if (runLength > 0) runs.add(Map.of("palette", previousIndex, "count", runLength));
                        previousIndex = index;
                        runLength = 1;
                    }
                }
            }
        }
        if (runLength > 0) runs.add(Map.of("palette", previousIndex, "count", runLength));

        return Map.of(
                "bounds", Map.of("from", positionJson(bounds.min), "to", positionJson(bounds.max)),
                "size", Map.of(
                        "x", bounds.max.getX() - bounds.min.getX() + 1,
                        "y", bounds.max.getY() - bounds.min.getY() + 1,
                        "z", bounds.max.getZ() - bounds.min.getZ() + 1
                ),
                "order", "y,z,x (x changes fastest)",
                "palette", new ArrayList<>(paletteIndexes.keySet()),
                "runs", runs
        );
    }

    private Object scanCollisionRegion(ServerLevel level, Bounds bounds) {
        validateVolume(bounds, MAX_BLOCKS, "Collision scan exceeds the 262,144 block limit");
        int count = Math.toIntExact(axisLength(bounds.min.getX(), bounds.max.getX())
                * axisLength(bounds.min.getY(), bounds.max.getY())
                * axisLength(bounds.min.getZ(), bounds.max.getZ()));
        String[] values = new String[count];
        int index = 0;
        int standable = 0;
        for (int y = bounds.min.getY(); y <= bounds.max.getY(); y++) {
            for (int z = bounds.min.getZ(); z <= bounds.max.getZ(); z++) {
                for (int x = bounds.min.getX(); x <= bounds.max.getX(); x++) {
                    BlockPos pos = new BlockPos(x, y, z);
                    requireLoaded(level, pos, "Collision scan");
                    if (isStandable(level, pos, 2)) {
                        values[index++] = "standable";
                        standable++;
                    } else if (level.getBlockState(pos).getCollisionShape(level, pos).isEmpty()) {
                        values[index++] = "passable";
                    } else {
                        values[index++] = "blocked";
                    }
                }
            }
        }
        return Map.of(
                "mode", "collision",
                "bounds", boundsJson(bounds),
                "order", "y,z,x (x changes fastest)",
                "palette", palette(values),
                "runs", stringRuns(values),
                "standableCells", standable,
                "profile", Map.of("height", 2, "footCollisionTolerance", 0.125)
        );
    }

    private Object scanLightingRegion(ServerLevel level, Bounds bounds) {
        validateVolume(bounds, MAX_BLOCKS, "Lighting scan exceeds the 262,144 block limit");
        int[] blockHistogram = new int[16];
        int[] skyHistogram = new int[16];
        var darkStandable = new ArrayList<Map<String, Integer>>();
        var spawnRisk = new ArrayList<Map<String, Integer>>();
        int darkCount = 0;
        int spawnRiskCount = 0;
        for (int y = bounds.min.getY(); y <= bounds.max.getY(); y++) {
            for (int z = bounds.min.getZ(); z <= bounds.max.getZ(); z++) {
                for (int x = bounds.min.getX(); x <= bounds.max.getX(); x++) {
                    BlockPos pos = new BlockPos(x, y, z);
                    requireLoaded(level, pos, "Lighting scan");
                    int block = level.getBrightness(LightLayer.BLOCK, pos);
                    int sky = level.getBrightness(LightLayer.SKY, pos);
                    blockHistogram[block]++;
                    skyHistogram[sky]++;
                    boolean standable = isStandable(level, pos, 2);
                    if (standable && Math.max(block, sky) <= 7) {
                        darkCount++;
                        if (darkStandable.size() < 128) darkStandable.add(positionJson(pos));
                    }
                    if (standable && block == 0 && sky == 0) {
                        spawnRiskCount++;
                        if (spawnRisk.size() < 128) spawnRisk.add(positionJson(pos));
                    }
                }
            }
        }
        var result = new LinkedHashMap<String, Object>();
        result.put("mode", "lighting");
        result.put("bounds", boundsJson(bounds));
        result.put("blockLightHistogram", histogramJson(blockHistogram));
        result.put("skyLightHistogram", histogramJson(skyHistogram));
        result.put("darkStandableCount", darkCount);
        result.put("darkStandable", darkStandable);
        result.put("darkStandableTruncated", darkCount > darkStandable.size());
        result.put("spawnRiskCandidateCount", spawnRiskCount);
        result.put("spawnRiskCandidates", spawnRisk);
        result.put("spawnRiskCandidatesTruncated", spawnRiskCount > spawnRisk.size());
        result.put("note", "Spawn risk is conservative: standable cells with block and sky light both zero");
        return result;
    }

    private static Map<String, Integer> histogramJson(int[] histogram) {
        var result = new LinkedHashMap<String, Integer>();
        for (int level = 0; level < histogram.length; level++) {
            if (histogram[level] > 0) result.put(Integer.toString(level), histogram[level]);
        }
        return result;
    }

    private Object validateAccess(HttpExchange exchange) {
        AccessRequest request = readBody(exchange, AccessRequest.class);
        if (request.from == null || request.to == null || request.start == null
                || request.goals == null || request.goals.isEmpty()) {
            throw new ApiException(400, "from, to, start, and at least one goal are required");
        }
        if (request.goals.size() > 32) throw new ApiException(400, "Access validation accepts at most 32 goals");
        return onServer(() -> validateAccessRequest(request));
    }

    private Object validateAccessRequest(AccessRequest request) {
        ServerLevel level = localPlayer().level();
        Bounds region = bounds(request.from, request.to);
        validateBuildHeight(level, region);
        validateVolume(region, MAX_BLOCKS, "Access search exceeds the 262,144 block limit");
        int height = request.height == null ? 2 : request.height;
        int maxStepUp = request.maxStepUp == null ? 1 : request.maxStepUp;
        int maxDrop = request.maxDrop == null ? 1 : request.maxDrop;
        int maxVisited = request.maxVisited == null ? 100_000 : request.maxVisited;
        if (height < 1 || height > 4 || maxStepUp < 0 || maxStepUp > 2 || maxDrop < 0 || maxDrop > 8
                || maxVisited < 1 || maxVisited > MAX_BLOCKS) {
            throw new ApiException(400, "Invalid access profile or maxVisited");
        }
        for (BlockPos pos : BlockPos.betweenClosed(region.min, region.max)) {
            requireLoaded(level, pos, "Access search");
        }
        BlockPos start = request.start.toBlockPos().immutable();
        List<BlockPos> goals = request.goals.stream().map(goal -> goal.toBlockPos().immutable()).toList();
        if (!inside(region, start) || goals.stream().anyMatch(goal -> !inside(region, goal))) {
            throw new ApiException(400, "Start and goals must be inside the access search bounds");
        }

        var queue = new ArrayDeque<BlockPos>();
        var parent = new HashMap<BlockPos, BlockPos>();
        queue.add(start);
        parent.put(start, null);
        var pending = new HashSet<>(goals);
        boolean limitReached = false;
        while (!queue.isEmpty() && !pending.isEmpty()) {
            BlockPos current = queue.removeFirst();
            pending.remove(current);
            if (parent.size() >= maxVisited) {
                limitReached = !queue.isEmpty() || !pending.isEmpty();
                break;
            }
            for (Direction direction : List.of(Direction.NORTH, Direction.SOUTH, Direction.WEST, Direction.EAST)) {
                for (int dy : verticalOffsets(maxStepUp, maxDrop)) {
                    BlockPos next = current.relative(direction).offset(0, dy, 0).immutable();
                    if (inside(region, next) && !parent.containsKey(next) && isStandable(level, next, height)) {
                        parent.put(next, current);
                        queue.addLast(next);
                    }
                }
            }
        }

        var goalResults = new ArrayList<Map<String, Object>>();
        boolean allReachable = true;
        for (BlockPos goal : goals) {
            boolean reachable = parent.containsKey(goal);
            allReachable &= reachable;
            var item = new LinkedHashMap<String, Object>();
            item.put("goal", positionJson(goal));
            item.put("reachable", reachable);
            item.put("standable", isStandable(level, goal, height));
            if (reachable) {
                var reversed = new ArrayList<BlockPos>();
                for (BlockPos cursor = goal; cursor != null; cursor = parent.get(cursor)) reversed.add(cursor);
                java.util.Collections.reverse(reversed);
                item.put("pathLength", reversed.size() - 1);
                int returned = Math.min(reversed.size(), 4096);
                item.put("path", reversed.subList(0, returned).stream().map(ArchitectHttpServer::positionJson).toList());
                item.put("pathTruncated", reversed.size() > returned);
            } else {
                BlockPos closest = parent.keySet().stream().min(Comparator.comparingLong(pos -> manhattan(pos, goal)))
                        .orElse(start);
                item.put("closestReachable", positionJson(closest));
                item.put("remainingManhattanDistance", manhattan(closest, goal));
            }
            goalResults.add(item);
        }
        var result = new LinkedHashMap<String, Object>();
        result.put("passed", allReachable);
        result.put("bounds", boundsJson(region));
        result.put("start", positionJson(start));
        result.put("startStandable", isStandable(level, start, height));
        result.put("visited", parent.size());
        result.put("limitReached", limitReached);
        result.put("profile", Map.of("height", height, "maxStepUp", maxStepUp, "maxDrop", maxDrop));
        result.put("goals", goalResults);
        return result;
    }

    private Object compareBlueprint(HttpExchange exchange) {
        CompareRequest request = readBody(exchange, CompareRequest.class);
        if (request.operations == null || request.operations.isEmpty()) {
            throw new ApiException(400, "operations must contain at least one cuboid");
        }
        if (request.operations.size() > MAX_OPERATIONS) {
            throw new ApiException(400, "Comparison exceeds the 256 operation limit");
        }
        return onServer(() -> compareDesired(request));
    }

    private Object compareDesired(CompareRequest request) {
        ServerLevel level = localPlayer().level();
        LinkedHashMap<BlockPos, BlockState> desired = desiredFromOperations(level, request.operations);
        boolean ignoreState = Boolean.TRUE.equals(request.ignoreState);
        int maxDifferences = request.maxDifferences == null ? 128 : request.maxDifferences;
        if (maxDifferences < 0 || maxDifferences > 2_048) {
            throw new ApiException(400, "maxDifferences must be between 0 and 2048");
        }
        int matched = 0;
        var counts = new LinkedHashMap<String, Integer>();
        var differences = new ArrayList<Map<String, Object>>();
        for (var entry : desired.entrySet()) {
            BlockPos pos = entry.getKey();
            requireLoaded(level, pos, "Blueprint comparison");
            BlockState expected = entry.getValue();
            BlockState actual = level.getBlockState(pos);
            boolean same = ignoreState ? expected.getBlock() == actual.getBlock() : expected == actual;
            if (same) {
                matched++;
                continue;
            }
            String kind = expected.isAir() && !actual.isAir() ? "unexpected"
                    : !expected.isAir() && actual.isAir() ? "missing" : "state-mismatch";
            increment(counts, kind);
            if (differences.size() < maxDifferences) {
                var difference = new LinkedHashMap<String, Object>();
                difference.put("position", positionJson(pos));
                difference.put("kind", kind);
                difference.put("expected", stateString(expected));
                difference.put("actual", stateString(actual));
                differences.add(difference);
            }
        }
        int differenceCount = desired.size() - matched;
        return Map.of(
                "passed", differenceCount == 0,
                "ignoreState", ignoreState,
                "comparedBlocks", desired.size(),
                "matchedBlocks", matched,
                "differenceCount", differenceCount,
                "differenceCounts", counts,
                "differences", differences,
                "differencesTruncated", differenceCount > differences.size()
        );
    }

    private static boolean isStandable(ServerLevel level, BlockPos feet, int height) {
        if (feet.getY() < level.getMinY() + 1 || feet.getY() + height > level.getMaxY()) return false;
        VoxelShape footShape = level.getBlockState(feet).getCollisionShape(level, feet);
        boolean lowFootCollision = !footShape.isEmpty() && footShape.max(Direction.Axis.Y) <= 0.1250001;
        if (!footShape.isEmpty() && !lowFootCollision) return false;
        for (int offset = 1; offset < height; offset++) {
            BlockPos body = feet.above(offset);
            if (!level.getBlockState(body).getCollisionShape(level, body).isEmpty()) return false;
        }
        BlockPos below = feet.below();
        return lowFootCollision || !level.getBlockState(below).getCollisionShape(level, below).isEmpty();
    }

    private static List<Integer> verticalOffsets(int maxStepUp, int maxDrop) {
        var values = new ArrayList<Integer>();
        values.add(0);
        for (int value = 1; value <= maxStepUp; value++) values.add(value);
        for (int value = 1; value <= maxDrop; value++) values.add(-value);
        return values;
    }

    private static boolean inside(Bounds bounds, BlockPos pos) {
        return pos.getX() >= bounds.min.getX() && pos.getX() <= bounds.max.getX()
                && pos.getY() >= bounds.min.getY() && pos.getY() <= bounds.max.getY()
                && pos.getZ() >= bounds.min.getZ() && pos.getZ() <= bounds.max.getZ();
    }

    private static long manhattan(BlockPos first, BlockPos second) {
        return Math.abs((long) first.getX() - second.getX())
                + Math.abs((long) first.getY() - second.getY())
                + Math.abs((long) first.getZ() - second.getZ());
    }

    private static void requireLoaded(ServerLevel level, BlockPos pos, String operation) {
        if (!level.hasChunkAt(pos)) {
            throw new ApiException(409, operation + " touches an unloaded chunk at " + pos.toShortString());
        }
    }

    private SurfaceScan scanSurface(ServerLevel level, Bounds bounds) {
        long widthLong = axisLength(bounds.min.getX(), bounds.max.getX());
        long depthLong = axisLength(bounds.min.getZ(), bounds.max.getZ());
        if (widthLong > MAX_SCAN_COLUMNS || depthLong > MAX_SCAN_COLUMNS / widthLong) {
            throw new ApiException(400, "Surface scan exceeds the 262,144 column limit");
        }
        int width = (int) widthLong;
        int depth = (int) depthLong;
        int[] heights = new int[width * depth];
        String[] states = new String[width * depth];
        TerrainKind[] kinds = new TerrainKind[width * depth];

        for (int dz = 0; dz < depth; dz++) {
            int z = bounds.min.getZ() + dz;
            for (int dx = 0; dx < width; dx++) {
                int x = bounds.min.getX() + dx;
                BlockPos column = new BlockPos(x, bounds.min.getY(), z);
                if (!level.hasChunkAt(column)) {
                    throw new ApiException(409, "Scan touches an unloaded chunk at " + column.toShortString());
                }

                int surfaceY = level.getHeight(Heightmap.Types.WORLD_SURFACE, x, z) - 1;
                if (surfaceY > bounds.max.getY()) {
                    surfaceY = findSurface(level, x, z, bounds.max.getY(), bounds.min.getY());
                } else if (surfaceY < bounds.min.getY()) {
                    surfaceY = bounds.min.getY() - 1;
                }
                int index = dz * width + dx;
                heights[index] = surfaceY;
                if (surfaceY < bounds.min.getY()) {
                    states[index] = "minecraft:air";
                    kinds[index] = TerrainKind.EMPTY;
                } else {
                    BlockState state = level.getBlockState(new BlockPos(x, surfaceY, z));
                    states[index] = stateString(state);
                    kinds[index] = classifySurface(state, states[index]);
                }
            }
        }
        return new SurfaceScan(bounds, width, depth, heights, states, kinds);
    }

    private static int findSurface(ServerLevel level, int x, int z, int startY, int minY) {
        for (int y = startY; y >= minY; y--) {
            if (!level.getBlockState(new BlockPos(x, y, z)).isAir()) return y;
        }
        return minY - 1;
    }

    private static TerrainKind classifySurface(BlockState state, String specification) {
        if (!state.getFluidState().isEmpty()) return TerrainKind.WATER;
        String id = specification.substring(0, specification.indexOf('[') < 0
                ? specification.length() : specification.indexOf('['));
        if (containsAny(id, "_leaves", "_log", "_wood", "mushroom_block", "mushroom_stem")) {
            return TerrainKind.TREE;
        }
        if (containsAny(id, "_planks", "_bricks", "brick_", "concrete", "terracotta", "glass",
                "_door", "_trapdoor", "_fence", "_wall", "_stairs", "_slab", "copper_", "iron_block")) {
            return TerrainKind.ARTIFICIAL;
        }
        return TerrainKind.NATURAL;
    }

    private static boolean containsAny(String value, String... needles) {
        for (String needle : needles) if (value.contains(needle)) return true;
        return false;
    }

    private static Object heightmapResponse(SurfaceScan scan) {
        return Map.of(
                "mode", "heightmap",
                "bounds", boundsJson(scan.bounds),
                "size", Map.of("x", scan.width, "z", scan.depth),
                "order", "z,x (x changes fastest)",
                "heightRuns", integerRuns(scan.heights),
                "surfacePalette", palette(scan.states),
                "surfaceRuns", stringRuns(scan.states),
                "classPalette", List.of("natural", "water", "tree", "artificial", "empty"),
                "classRuns", kindRuns(scan.kinds)
        );
    }

    private static Object summaryResponse(SurfaceScan scan) {
        int min = Integer.MAX_VALUE;
        int max = Integer.MIN_VALUE;
        long total = 0;
        int present = 0;
        var counts = new LinkedHashMap<String, Integer>();
        for (TerrainKind kind : TerrainKind.values()) counts.put(kind.jsonName, 0);
        for (int index = 0; index < scan.heights.length; index++) {
            counts.compute(scan.kinds[index].jsonName, (ignored, count) -> count + 1);
            if (scan.kinds[index] != TerrainKind.EMPTY) {
                min = Math.min(min, scan.heights[index]);
                max = Math.max(max, scan.heights[index]);
                total += scan.heights[index];
                present++;
            }
        }

        long slopeTotal = 0;
        int slopeEdges = 0;
        int maxSlope = 0;
        boolean[] flat = new boolean[scan.heights.length];
        for (int z = 0; z < scan.depth; z++) {
            for (int x = 0; x < scan.width; x++) {
                int index = z * scan.width + x;
                TerrainKind kind = scan.kinds[index];
                boolean usable = kind == TerrainKind.NATURAL;
                if (x + 1 < scan.width) {
                    int rise = slopeBetween(scan, index, index + 1);
                    if (rise >= 0) {
                        slopeTotal += rise;
                        slopeEdges++;
                        maxSlope = Math.max(maxSlope, rise);
                        usable &= rise <= 1;
                    }
                }
                if (x > 0) usable &= slopeBetween(scan, index, index - 1) <= 1;
                if (z + 1 < scan.depth) {
                    int rise = slopeBetween(scan, index, index + scan.width);
                    if (rise >= 0) {
                        slopeTotal += rise;
                        slopeEdges++;
                        maxSlope = Math.max(maxSlope, rise);
                        usable &= rise <= 1;
                    }
                }
                if (z > 0) usable &= slopeBetween(scan, index, index - scan.width) <= 1;
                flat[index] = usable;
            }
        }

        Map<String, Object> elevation = new LinkedHashMap<>();
        elevation.put("min", present == 0 ? null : min);
        elevation.put("max", present == 0 ? null : max);
        elevation.put("average", present == 0 ? null : Math.round((double) total / present * 100.0) / 100.0);
        return Map.of(
                "mode", "summary",
                "bounds", boundsJson(scan.bounds),
                "columns", scan.heights.length,
                "elevation", elevation,
                "slope", Map.of(
                        "averageRisePerBlock", slopeEdges == 0 ? 0.0
                                : Math.round((double) slopeTotal / slopeEdges * 100.0) / 100.0,
                        "maximumRise", maxSlope
                ),
                "coverage", coverage(counts, scan.heights.length),
                "flatAreas", flatAreas(scan, flat)
        );
    }

    private static int slopeBetween(SurfaceScan scan, int first, int second) {
        if (scan.kinds[first] == TerrainKind.EMPTY || scan.kinds[second] == TerrainKind.EMPTY) return -1;
        return Math.abs(scan.heights[first] - scan.heights[second]);
    }

    private static Map<String, Object> coverage(Map<String, Integer> counts, int total) {
        var result = new LinkedHashMap<String, Object>();
        counts.forEach((name, count) -> result.put(name, Map.of(
                "columns", count,
                "percent", Math.round((double) count / total * 10_000.0) / 100.0
        )));
        return result;
    }

    private static List<Map<String, Object>> flatAreas(SurfaceScan scan, boolean[] flat) {
        boolean[] visited = new boolean[flat.length];
        var areas = new ArrayList<Map<String, Object>>();
        for (int start = 0; start < flat.length; start++) {
            if (!flat[start] || visited[start]) continue;
            var queue = new ArrayDeque<Integer>();
            queue.add(start);
            visited[start] = true;
            int count = 0;
            int minX = scan.width;
            int maxX = 0;
            int minZ = scan.depth;
            int maxZ = 0;
            int minY = Integer.MAX_VALUE;
            int maxY = Integer.MIN_VALUE;
            long totalY = 0;
            while (!queue.isEmpty()) {
                int index = queue.removeFirst();
                int x = index % scan.width;
                int z = index / scan.width;
                count++;
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minZ = Math.min(minZ, z);
                maxZ = Math.max(maxZ, z);
                minY = Math.min(minY, scan.heights[index]);
                maxY = Math.max(maxY, scan.heights[index]);
                totalY += scan.heights[index];
                enqueueFlat(queue, visited, flat, index, x > 0 ? index - 1 : -1);
                enqueueFlat(queue, visited, flat, index, x + 1 < scan.width ? index + 1 : -1);
                enqueueFlat(queue, visited, flat, index, z > 0 ? index - scan.width : -1);
                enqueueFlat(queue, visited, flat, index, z + 1 < scan.depth ? index + scan.width : -1);
            }
            if (count >= 16) {
                int boxColumns = (maxX - minX + 1) * (maxZ - minZ + 1);
                areas.add(Map.of(
                        "from", Map.of("x", scan.bounds.min.getX() + minX, "z", scan.bounds.min.getZ() + minZ),
                        "to", Map.of("x", scan.bounds.min.getX() + maxX, "z", scan.bounds.min.getZ() + maxZ),
                        "usableColumns", count,
                        "boundingBoxCoveragePercent", Math.round((double) count / boxColumns * 10_000.0) / 100.0,
                        "elevation", Map.of("min", minY, "max", maxY,
                                "average", Math.round((double) totalY / count * 100.0) / 100.0)
                ));
            }
        }
        return areas.stream()
                .sorted(Comparator.comparingInt(area -> -((Number) area.get("usableColumns")).intValue()))
                .limit(8)
                .toList();
    }

    private static void enqueueFlat(ArrayDeque<Integer> queue, boolean[] visited, boolean[] flat,
                                    int current, int neighbor) {
        if (neighbor >= 0 && !visited[neighbor] && flat[neighbor]) {
            visited[neighbor] = true;
            queue.addLast(neighbor);
        }
    }

    private static List<String> palette(String[] values) {
        return new ArrayList<>(new java.util.LinkedHashSet<>(List.of(values)));
    }

    private static List<Map<String, Integer>> stringRuns(String[] values) {
        var indexes = new LinkedHashMap<String, Integer>();
        int[] encoded = new int[values.length];
        for (int i = 0; i < values.length; i++) {
            encoded[i] = indexes.computeIfAbsent(values[i], ignored -> indexes.size());
        }
        return integerRuns(encoded);
    }

    private static List<Map<String, Integer>> kindRuns(TerrainKind[] values) {
        int[] encoded = new int[values.length];
        for (int i = 0; i < values.length; i++) encoded[i] = values[i].ordinal();
        return integerRuns(encoded);
    }

    private static List<Map<String, Integer>> integerRuns(int[] values) {
        var runs = new ArrayList<Map<String, Integer>>();
        if (values.length == 0) return runs;
        int value = values[0];
        int count = 1;
        for (int i = 1; i < values.length; i++) {
            if (values[i] == value) {
                count++;
            } else {
                runs.add(Map.of("value", value, "count", count));
                value = values[i];
                count = 1;
            }
        }
        runs.add(Map.of("value", value, "count", count));
        return runs;
    }

    private static Map<String, Object> boundsJson(Bounds bounds) {
        return Map.of("from", positionJson(bounds.min), "to", positionJson(bounds.max));
    }

    private LinkedHashMap<BlockPos, BlockState> desiredFromOperations(ServerLevel level, List<FillRequest> operations) {
        var desired = new LinkedHashMap<BlockPos, BlockState>();
        var parsedStates = new HashMap<String, BlockState>();

        for (FillRequest operation : operations) {
            if (operation == null || operation.from == null || operation.to == null || operation.block == null) {
                throw new ApiException(400, "Every operation requires from, to, and block");
            }
            Bounds bounds = bounds(operation.from, operation.to);
            validateBounds(level, bounds);
            BlockState replacement = parsedStates.computeIfAbsent(operation.block, ArchitectHttpServer::parseBlockState);
            if (replacement.hasBlockEntity()) {
                throw new ApiException(400, "Block entities are not supported: " + operation.block);
            }
            for (BlockPos cursor : BlockPos.betweenClosed(bounds.min, bounds.max)) {
                desired.put(cursor.immutable(), replacement);
                if (desired.size() > MAX_BLOCKS) {
                    throw new ApiException(400, "Blueprint exceeds the 262,144 block limit");
                }
            }
        }
        return desired;
    }

    private Object projectRequest(HttpExchange exchange) { return engineRequest(exchange, "project"); }

    private Object engineRequest(HttpExchange exchange, String kind) {
        JsonObject request = readBody(exchange, JsonObject.class);
        CompletableFuture<Object> future = onServer(() -> {
            String action = request.has("action") ? request.get("action").getAsString() : "";
            boolean starts = Set.of("start", "resume", "rollback", "restore").contains(action);
            if (starts) {
                if (!kind.equals("circuit") && redstone.values().stream().anyMatch(RedstoneEngine::enabled)) throw new ApiException(409, "Disable redstone acceleration before construction");
                if (!kind.equals("circuit") && circuits.ownsWriter()) throw new ApiException(409, "Cancel the active circuit test first");
                if (kind.equals("circuit") && (assemblies.ownsWriter() || projectBuilds.ownsWriter())) throw new ApiException(409, "Pause construction before testing");
                if (kind.equals("project") && assemblies.ownsWriter()) throw new ApiException(409, "Control the assembly that owns this project");
            }
            if (kind.equals("project") && action.equals("pause") && assemblies.ownsWriter()) throw new ApiException(409, "Pause the assembly instead");
            return switch (kind) {
                case "assembly" -> assemblies.request(request);
                case "circuit" -> circuits.request(request);
                default -> projectBuilds.request(request);
            };
        });
        try { return future.get(60, TimeUnit.SECONDS); }
        catch (Exception exception) {
            Throwable cause = exception; while (cause.getCause() != null) cause = cause.getCause();
            if (cause instanceof IllegalArgumentException) throw new ApiException(400, cause.getMessage());
            if (cause instanceof IllegalStateException) throw new ApiException(409, cause.getMessage());
            if (cause instanceof java.nio.file.NoSuchFileException) throw new ApiException(409, "Artifact missing; finish upload or check its ID");
            throw new ApiException(500, "Engine storage request failed; inspect status before retrying", cause);
        }
    }

    private static void increment(Map<String, Integer> counts, String key) {
        counts.merge(key, 1, Integer::sum);
    }

    private static Bounds bounds(PositionRequest fromRequest, PositionRequest toRequest) {
        BlockPos from = fromRequest.toBlockPos();
        BlockPos to = toRequest.toBlockPos();
        BlockPos min = new BlockPos(
                Math.min(from.getX(), to.getX()),
                Math.min(from.getY(), to.getY()),
                Math.min(from.getZ(), to.getZ())
        );
        BlockPos max = new BlockPos(
                Math.max(from.getX(), to.getX()),
                Math.max(from.getY(), to.getY()),
                Math.max(from.getZ(), to.getZ())
        );
        return new Bounds(min, max);
    }

    private static void validateBounds(ServerLevel level, Bounds bounds) {
        validateBuildHeight(level, bounds);
        validateVolume(bounds, MAX_BLOCKS, "Operation exceeds the 262,144 block limit");
    }

    private static void validateBuildHeight(ServerLevel level, Bounds bounds) {
        BlockPos min = bounds.min;
        BlockPos max = bounds.max;
        if (min.getY() < level.getMinY() || max.getY() >= level.getMaxY()) {
            throw new ApiException(400, "Operation is outside the world's build height");
        }
    }

    private static void validateVolume(Bounds bounds, long limit, String message) {
        long x = axisLength(bounds.min.getX(), bounds.max.getX());
        long y = axisLength(bounds.min.getY(), bounds.max.getY());
        long z = axisLength(bounds.min.getZ(), bounds.max.getZ());
        if (x > limit || y > limit / x || z > limit / (x * y)) {
            throw new ApiException(400, message);
        }
    }

    private static long axisLength(int min, int max) {
        return (long) max - min + 1L;
    }

    static BlockState parseBlockState(String specification) {
        int propertiesStart = specification.indexOf('[');
        String blockId = propertiesStart < 0 ? specification : specification.substring(0, propertiesStart);
        Identifier id = Identifier.tryParse(blockId);
        if (id == null) {
            throw new ApiException(400, "Invalid block ID: " + blockId);
        }
        var block = BuiltInRegistries.BLOCK.getOptional(id)
                .orElseThrow(() -> new ApiException(400, "Unknown block ID: " + blockId));
        BlockState state = block.defaultBlockState();
        if (propertiesStart < 0) return state;
        if (!specification.endsWith("]")) {
            throw new ApiException(400, "Invalid block state: " + specification);
        }
        String properties = specification.substring(propertiesStart + 1, specification.length() - 1);
        if (properties.isBlank()) return state;
        for (String assignment : properties.split(",")) {
            String[] pair = assignment.split("=", 2);
            if (pair.length != 2) throw new ApiException(400, "Invalid block property: " + assignment);
            Property<?> property = block.getStateDefinition().getProperty(pair[0].trim());
            if (property == null) throw new ApiException(400, "Unknown property for " + blockId + ": " + pair[0]);
            state = setProperty(state, property, pair[1].trim(), specification);
        }
        return state;
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static BlockState setProperty(BlockState state, Property property, String value, String specification) {
        Optional<?> parsedValue = property.getValue(value);
        if (parsedValue.isEmpty()) {
            throw new ApiException(400, "Invalid property value in " + specification);
        }
        Comparable parsed = (Comparable) parsedValue.get();
        return (BlockState) state.setValue(property, parsed);
    }

    static String stateString(BlockState state) {
        StringBuilder result = new StringBuilder(BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());
        if (!state.getValues().isEmpty()) {
            result.append('[');
            boolean first = true;
            for (var entry : state.getValues().entrySet().stream()
                    .sorted(Map.Entry.comparingByKey(Comparator.comparing(Property::getName))).toList()) {
                if (!first) result.append(',');
                first = false;
                result.append(entry.getKey().getName()).append('=').append(propertyValueName(entry.getKey(), entry.getValue()));
            }
            result.append(']');
        }
        return result.toString();
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static String propertyValueName(Property property, Comparable value) {
        return property.getName(value);
    }

    private ServerLevel findLevel(String dimension) {
        MinecraftServer server = minecraftServer;
        if (server == null) throw new ApiException(409, "No single-player world is open");
        for (ServerLevel level : server.getAllLevels()) {
            if (level.dimension().identifier().toString().equals(dimension)) return level;
        }
        throw new ApiException(409, "Camera dimension is not available: " + dimension);
    }

    private ServerPlayer localPlayer() {
        MinecraftServer server = minecraftServer;
        if (server == null) {
            throw new ApiException(409, "No single-player world is open");
        }
        return server.getPlayerList().getPlayers().stream().findFirst()
                .orElseThrow(() -> new ApiException(409, "No player is available"));
    }

    private <T> T onServer(Supplier<T> action) {
        MinecraftServer server = minecraftServer;
        if (server == null) {
            throw new ApiException(409, "No single-player world is open");
        }
        CompletableFuture<T> future = new CompletableFuture<>();
        server.execute(() -> {
            try {
                future.complete(action.get());
            } catch (Throwable throwable) {
                future.completeExceptionally(throwable);
            }
        });
        try {
            return future.get(60, TimeUnit.SECONDS);
        } catch (Exception exception) {
            Throwable cause = exception.getCause();
            if (cause instanceof ApiException apiException) {
                throw apiException;
            }
            throw new ApiException(500, "Minecraft did not complete the operation", exception);
        }
    }

    private boolean isAuthorized(HttpExchange exchange) {
        String authorization = exchange.getRequestHeaders().getFirst("Authorization");
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            return false;
        }
        byte[] supplied = authorization.substring(7).getBytes(StandardCharsets.UTF_8);
        byte[] expected = config.token().getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(supplied, expected);
    }

    private static <T> T readBody(HttpExchange exchange, Class<T> type) {
        return readOptionalBody(exchange, type).orElseThrow(() -> new ApiException(400, "JSON body is required"));
    }

    private static <T> Optional<T> readOptionalBody(HttpExchange exchange, Class<T> type) {
        try {
            int declaredLength = parseContentLength(exchange);
            if (declaredLength > MAX_BODY_BYTES) {
                throw new ApiException(413, "Request body is too large");
            }
            byte[] bytes = exchange.getRequestBody().readNBytes(MAX_BODY_BYTES + 1);
            if (bytes.length > MAX_BODY_BYTES) {
                throw new ApiException(413, "Request body is too large");
            }
            if (bytes.length == 0) {
                return Optional.empty();
            }
            T parsed = GSON.fromJson(new String(bytes, StandardCharsets.UTF_8), type);
            return Optional.ofNullable(parsed);
        } catch (ApiException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new ApiException(400, "Invalid JSON body", exception);
        }
    }

    private static int parseContentLength(HttpExchange exchange) {
        String value = exchange.getRequestHeaders().getFirst("Content-Length");
        if (value == null) return -1;
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException exception) {
            throw new ApiException(400, "Invalid Content-Length");
        }
    }

    private static Map<String, Integer> positionJson(BlockPos pos) {
        return Map.of("x", pos.getX(), "y", pos.getY(), "z", pos.getZ());
    }

    private static void writeJson(HttpExchange exchange, int status, Object body) throws IOException {
        byte[] bytes = GSON.toJson(body).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }

    private interface ExchangeAction {
        Object run(HttpExchange exchange);
    }

    private static final class FillRequest {
        PositionRequest from;
        PositionRequest to;
        String block;
    }

    private static final class CompareRequest {
        List<FillRequest> operations;
        Boolean ignoreState;
        Integer maxDifferences;
    }

    private static final class AccessRequest {
        PositionRequest from;
        PositionRequest to;
        PositionRequest start;
        List<PositionRequest> goals;
        Integer height;
        Integer maxStepUp;
        Integer maxDrop;
        Integer maxVisited;
    }

    private static class RegionRequest {
        PositionRequest from;
        PositionRequest to;
        String mode;
    }

    private static final class PositionRequest {
        int x;
        int y;
        int z;

        BlockPos toBlockPos() {
            return new BlockPos(x, y, z);
        }
    }

    private record OpenWorldRequest(String levelId) {}

    private static final class CameraBeginRequest {
        Boolean spectator;
    }

    private static final class CameraMoveRequest {
        DoublePositionRequest position;
        Float yaw;
        Float pitch;
        Integer fov;
    }

    private static final class DoublePositionRequest {
        Double x;
        Double y;
        Double z;
    }

    private record Bounds(BlockPos min, BlockPos max) {}

    private record SurfaceScan(Bounds bounds, int width, int depth, int[] heights, String[] states,
                               TerrainKind[] kinds) {}

    private record CameraSession(String dimension, double x, double y, double z, float yaw, float pitch,
                                 GameType gameMode, int fov) {}

    private enum TerrainKind {
        NATURAL("natural"), WATER("water"), TREE("tree"), ARTIFICIAL("artificial"), EMPTY("empty");

        final String jsonName;

        TerrainKind(String jsonName) {
            this.jsonName = jsonName;
        }
    }

    private static final class ApiException extends RuntimeException {
        final int status;

        ApiException(int status, String message) {
            super(message);
            this.status = status;
        }

        ApiException(int status, String message, Throwable cause) {
            super(message, cause);
            this.status = status;
        }
    }
}
