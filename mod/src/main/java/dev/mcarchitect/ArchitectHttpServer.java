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
import net.minecraft.world.level.block.Mirror;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraft.world.phys.shapes.VoxelShape;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;
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
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;
import java.util.function.Supplier;

final class ArchitectHttpServer {
    private static final Gson GSON = new Gson();
    private static final int MAX_BODY_BYTES = 256 * 1024;
    private static final long MAX_BLOCKS = 262_144;
    private static final long MAX_SCAN_COLUMNS = 262_144;
    private static final int MAX_OPERATIONS = 256;
    private static final int MAX_TRANSACTIONS = 100;
    private static final int JOB_BLOCKS_PER_TICK = 2_048;

    private final ArchitectConfig config;
    private final ArrayDeque<Transaction> transactions = new ArrayDeque<>();
    private volatile MinecraftServer minecraftServer;
    private CameraSession cameraSession;
    private BuildingJob buildingJob;

    ArchitectHttpServer(ArchitectConfig config) {
        this.config = config;
    }

    void start() {
        try {
            var address = new InetSocketAddress(InetAddress.getLoopbackAddress(), config.port());
            HttpServer server = HttpServer.create(address, 0);
            server.createContext("/v1/health", route("GET", false, this::health));
            server.createContext("/v1/ui", route("GET", true, this::uiState));
            server.createContext("/v1/worlds", route("GET", true, this::listWorlds));
            server.createContext("/v1/open-world", route("POST", true, this::openWorld));
            server.createContext("/v1/disconnect", route("POST", true, this::disconnect));
            server.createContext("/v1/screenshot", route("POST", true, this::screenshot));
            server.createContext("/v1/camera/begin", route("POST", true, this::beginCamera));
            server.createContext("/v1/camera/move", route("POST", true, this::moveCamera));
            server.createContext("/v1/camera/restore", route("POST", true, this::restoreCamera));
            server.createContext("/v1/context", route("GET", true, this::context));
            server.createContext("/v1/scan", route("POST", true, this::scan));
            server.createContext("/v1/access", route("POST", true, this::validateAccess));
            server.createContext("/v1/compare", route("POST", true, this::compareBlueprint));
            server.createContext("/v1/apply", route("POST", true, this::apply));
            server.createContext("/v1/transform", route("POST", true, this::transform));
            server.createContext("/v1/replace", route("POST", true, this::replace));
            server.createContext("/v1/fill", route("POST", true, this::fill));
            server.createContext("/v1/transactions", route("GET", true, this::listTransactions));
            server.createContext("/v1/undo", route("POST", true, this::undo));
            server.createContext("/v1/jobs", route("POST", true, this::startJob));
            server.createContext("/v1/jobs/status", route("GET", true, this::jobStatus));
            server.createContext("/v1/jobs/control", route("POST", true, this::controlJob));
            server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
            server.start();
            McArchitectMod.LOGGER.info("MC Architect listening on 127.0.0.1:{}", config.port());
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to start MC Architect HTTP server", exception);
        }
    }

    void setMinecraftServer(MinecraftServer server) {
        CameraSession abandoned = cameraSession;
        cameraSession = null;
        if (server == null && abandoned != null) {
            ArchitectClientController.get().setFov(abandoned.fov);
        }
        minecraftServer = server;
        buildingJob = null;
        synchronized (transactions) {
            transactions.clear();
        }
        if (server != null) loadTransactions(server);
        if (server != null) loadBuildingJob(server);
    }

    void tick(MinecraftServer server) {
        BuildingJob job = buildingJob;
        if (job == null || job.status != JobStatus.RUNNING || minecraftServer != server) return;
        ServerLevel level;
        try {
            level = findLevel(job.dimension);
        } catch (RuntimeException exception) {
            job.status = JobStatus.PAUSED;
            job.error = exception.getMessage();
            saveJobProgress(job);
            return;
        }
        int end = Math.min(job.blocks.size(), job.progress + JOB_BLOCKS_PER_TICK);
        try {
            for (int index = job.progress; index < end; index++) {
                JobBlock block = job.blocks.get(index);
                BlockState current = level.getBlockState(block.position());
                if (current == block.after()) continue;
                if (current != block.before()) {
                    throw new ApiException(409, "Job checkpoint conflict at " + block.position().toShortString()
                            + "; the block changed outside this job");
                }
                if (!level.setBlock(block.position(), block.after(), 3)
                        && level.getBlockState(block.position()) != block.after()) {
                    throw new ApiException(409, "Minecraft rejected a job change at " + block.position().toShortString());
                }
            }
            job.progress = end;
            saveJobProgress(job);
            if (job.progress == job.blocks.size()) completeBuildingJob(job);
        } catch (RuntimeException exception) {
            job.status = JobStatus.PAUSED;
            job.error = exception.getMessage();
            saveJobProgress(job);
            McArchitectMod.LOGGER.error("MC Architect job {} paused after an error", job.id, exception);
        }
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
                "modVersion", "0.5.0",
                "worldOpen", server != null,
                "playerAvailable", server != null && !server.getPlayerList().getPlayers().isEmpty(),
                "limits", Map.of(
                        "blocksPerTransaction", MAX_BLOCKS,
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
                    "position", Map.of("x", player.getX(), "y", player.getY(), "z", player.getZ()),
                    "blockPosition", positionJson(player.blockPosition()),
                    "rotation", Map.of("yaw", player.getYRot(), "pitch", player.getXRot()),
                    "dimension", player.level().dimension().identifier().toString(),
                    "gameMode", player.gameMode.getGameModeForPlayer().getName()
            );
        });
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
        return ArchitectClientController.get().captureScreenshot();
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

    private Object fill(HttpExchange exchange) {
        FillRequest request = readBody(exchange, FillRequest.class);
        if (request.from == null || request.to == null || request.block == null) {
            throw new ApiException(400, "from, to, and block are required");
        }
        return onServer(() -> applyOperations(List.of(request), "fill", null, false));
    }

    private Object apply(HttpExchange exchange) {
        ApplyRequest request = readBody(exchange, ApplyRequest.class);
        if (request.operations == null || request.operations.isEmpty()) {
            throw new ApiException(400, "operations must contain at least one cuboid");
        }
        if (request.operations.size() > MAX_OPERATIONS) {
            throw new ApiException(400, "Blueprint exceeds the 256 operation limit");
        }
        return onServer(() -> applyOperations(request.operations, request.label, request.projectId, request.dryRun));
    }

    private Object transform(HttpExchange exchange) {
        TransformRequest request = readBody(exchange, TransformRequest.class);
        if (request.from == null || request.to == null || request.target == null) {
            throw new ApiException(400, "from, to, and target are required");
        }
        return onServer(() -> transformRegion(request));
    }

    private Object replace(HttpExchange exchange) {
        ReplaceRequest request = readBody(exchange, ReplaceRequest.class);
        if (request.from == null || request.to == null || request.match == null || request.match.isEmpty()
                || request.block == null) {
            throw new ApiException(400, "from, to, match, and block are required");
        }
        return onServer(() -> replaceRegion(request));
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

    private Object applyOperations(List<FillRequest> operations, String label, String projectId, boolean dryRun) {
        ServerPlayer player = localPlayer();
        ServerLevel level = player.level();
        var desired = desiredFromOperations(level, operations);
        return applyDesired(level, desired, label, projectId, dryRun, operations.size());
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

    private Object startJob(HttpExchange exchange) {
        JobRequest request = readBody(exchange, JobRequest.class);
        if (request.operations == null || request.operations.isEmpty()) {
            throw new ApiException(400, "operations must contain at least one cuboid");
        }
        if (request.operations.size() > MAX_OPERATIONS) {
            throw new ApiException(400, "Job exceeds the 256 operation limit");
        }
        return onServer(() -> createBuildingJob(request));
    }

    private Object createBuildingJob(JobRequest request) {
        if (buildingJob != null) throw new ApiException(409, "Another building job is already active");
        ServerLevel level = localPlayer().level();
        var desired = desiredFromOperations(level, request.operations);
        BlueprintAnalysis analysis = analyzeDesired(level, desired);
        if (!analysis.unloadedChunks.isEmpty()) {
            throw new ApiException(409, "Job touches " + analysis.unloadedChunks.size()
                    + " unloaded chunks; first: " + analysis.unloadedChunks.getFirst());
        }
        if (!analysis.blockEntities.isEmpty()) {
            throw new ApiException(409, "Job would overwrite " + analysis.blockEntities.size()
                    + " block entities; first: " + analysis.blockEntities.getFirst());
        }
        if (!analysis.players.isEmpty()) {
            throw new ApiException(409, "Job collides with players: " + String.join(", ", analysis.players));
        }
        if (analysis.before.isEmpty()) return Map.of(
                "accepted", true, "complete", true, "changedBlocks", 0,
                "message", "All requested blocks already match");
        UUID id = UUID.randomUUID();
        List<JobBlock> blocks = analysis.before.entrySet().stream()
                .map(entry -> new JobBlock(entry.getKey(), entry.getValue(), desired.get(entry.getKey())))
                .toList();
        BuildingJob job = new BuildingJob(id, Instant.now(), level.dimension().identifier().toString(),
                request.label == null || request.label.isBlank() ? "building job" : request.label,
                normalizeProjectId(request.projectId), blocks, 0, JobStatus.RUNNING, null,
                jobPlanFile(level.getServer(), id), jobProgressFile(level.getServer(), id));
        try {
            saveJobPlan(job);
            writeJobProgress(job);
        } catch (IOException exception) {
            deleteBuildingJobFiles(job);
            throw new ApiException(500, "Unable to persist building job checkpoint", exception);
        }
        buildingJob = job;
        return jobStatusResponse(job);
    }

    private Object jobStatus(HttpExchange ignored) {
        return onServer(() -> buildingJob == null
                ? Map.of("active", false)
                : jobStatusResponse(buildingJob));
    }

    private Object controlJob(HttpExchange exchange) {
        JobControlRequest request = readBody(exchange, JobControlRequest.class);
        return onServer(() -> controlBuildingJob(request));
    }

    private Object controlBuildingJob(JobControlRequest request) {
        BuildingJob job = buildingJob;
        if (job == null) throw new ApiException(409, "There is no active building job");
        if (request.jobId != null && !job.id.toString().equals(request.jobId)) {
            throw new ApiException(409, "The requested building job is not active");
        }
        return switch (request.action == null ? "" : request.action) {
            case "pause" -> {
                job.status = JobStatus.PAUSED;
                saveJobProgress(job);
                yield jobStatusResponse(job);
            }
            case "resume" -> {
                job.status = JobStatus.RUNNING;
                job.error = null;
                saveJobProgress(job);
                yield jobStatusResponse(job);
            }
            case "cancel" -> cancelBuildingJob(job);
            default -> throw new ApiException(400, "action must be one of: pause, resume, cancel");
        };
    }

    private Object transformRegion(TransformRequest request) {
        ServerLevel level = localPlayer().level();
        Bounds source = bounds(request.from, request.to);
        validateBounds(level, source);
        int rotationDegrees = request.rotation == null ? 0 : request.rotation;
        Rotation rotation = switch (rotationDegrees) {
            case 0 -> Rotation.NONE;
            case 90 -> Rotation.CLOCKWISE_90;
            case 180 -> Rotation.CLOCKWISE_180;
            case 270 -> Rotation.COUNTERCLOCKWISE_90;
            default -> throw new ApiException(400, "rotation must be one of: 0, 90, 180, 270");
        };
        String mirrorName = request.mirror == null ? "none" : request.mirror;
        Mirror mirror = switch (mirrorName) {
            case "none" -> Mirror.NONE;
            case "x" -> Mirror.FRONT_BACK;
            case "z" -> Mirror.LEFT_RIGHT;
            default -> throw new ApiException(400, "mirror must be one of: none, x, z");
        };
        int copies = request.copies == null ? 1 : request.copies;
        if (copies < 1 || copies > 64) throw new ApiException(400, "copies must be between 1 and 64");
        int spacingX = request.spacing == null ? 0 : request.spacing.x;
        int spacingY = request.spacing == null ? 0 : request.spacing.y;
        int spacingZ = request.spacing == null ? 0 : request.spacing.z;
        boolean includeAir = request.includeAir != null && request.includeAir;
        int width = source.max.getX() - source.min.getX() + 1;
        int depth = source.max.getZ() - source.min.getZ() + 1;
        var desired = new LinkedHashMap<BlockPos, BlockState>();

        for (BlockPos cursor : BlockPos.betweenClosed(source.min, source.max)) {
            if (!level.hasChunkAt(cursor)) {
                throw new ApiException(409, "Source touches an unloaded chunk at " + cursor.toShortString());
            }
            if (level.getBlockEntity(cursor) != null) {
                throw new ApiException(409, "Source contains an unsupported block entity at " + cursor.toShortString());
            }
            BlockState state = level.getBlockState(cursor);
            if (!includeAir && state.isAir()) continue;
            int localX = cursor.getX() - source.min.getX();
            int localY = cursor.getY() - source.min.getY();
            int localZ = cursor.getZ() - source.min.getZ();
            if ("x".equals(mirrorName)) localX = width - 1 - localX;
            if ("z".equals(mirrorName)) localZ = depth - 1 - localZ;
            int transformedX;
            int transformedZ;
            switch (rotationDegrees) {
                case 90 -> {
                    transformedX = depth - 1 - localZ;
                    transformedZ = localX;
                }
                case 180 -> {
                    transformedX = width - 1 - localX;
                    transformedZ = depth - 1 - localZ;
                }
                case 270 -> {
                    transformedX = localZ;
                    transformedZ = width - 1 - localX;
                }
                default -> {
                    transformedX = localX;
                    transformedZ = localZ;
                }
            }
            BlockState transformedState = state.mirror(mirror).rotate(rotation);
            for (int copy = 0; copy < copies; copy++) {
                BlockPos target = new BlockPos(
                        request.target.x + transformedX + spacingX * copy,
                        request.target.y + localY + spacingY * copy,
                        request.target.z + transformedZ + spacingZ * copy
                );
                if (target.getY() < level.getMinY() || target.getY() >= level.getMaxY()) {
                    throw new ApiException(400, "Transformed structure is outside the world's build height");
                }
                desired.put(target, transformedState);
                if (desired.size() > MAX_BLOCKS) {
                    throw new ApiException(400, "Transformed structure exceeds the 262,144 block limit");
                }
            }
        }
        return applyDesired(level, desired, request.label, request.projectId,
                request.dryRun, 1);
    }

    private Object replaceRegion(ReplaceRequest request) {
        ServerLevel level = localPlayer().level();
        Bounds region = bounds(request.from, request.to);
        validateBounds(level, region);
        BlockState replacement = parseBlockState(request.block);
        if (replacement.hasBlockEntity()) {
            throw new ApiException(400, "Block entities are not supported: " + request.block);
        }
        Set<String> matches = new HashSet<>(request.match);
        var desired = new LinkedHashMap<BlockPos, BlockState>();
        for (BlockPos cursor : BlockPos.betweenClosed(region.min, region.max)) {
            if (!level.hasChunkAt(cursor)) {
                throw new ApiException(409, "Replace region touches an unloaded chunk at " + cursor.toShortString());
            }
            BlockState current = level.getBlockState(cursor);
            String state = stateString(current);
            String block = BuiltInRegistries.BLOCK.getKey(current.getBlock()).toString();
            if (matches.contains(state) || matches.contains(block)) {
                desired.put(cursor.immutable(), replacement);
            }
        }
        return applyDesired(level, desired, request.label == null ? "replace blocks" : request.label,
                request.projectId, request.dryRun, 1);
    }

    private Object applyDesired(ServerLevel level, LinkedHashMap<BlockPos, BlockState> desired,
                                String label, String projectId, boolean dryRun, int operationCount) {
        if (desired.isEmpty()) {
            return Map.of("dryRun", dryRun, "requestedBlocks", 0, "changedBlocks", 0,
                    "message", "No blocks matched the request");
        }
        BlueprintAnalysis analysis = analyzeDesired(level, desired);
        if (dryRun) return previewResponse(analysis);
        if (buildingJob != null) {
            throw new ApiException(409, "A background building job is active; pause and cancel it before direct edits");
        }
        if (!analysis.unloadedChunks.isEmpty()) {
            throw new ApiException(409, "Operation touches " + analysis.unloadedChunks.size()
                    + " unloaded chunks; first: " + analysis.unloadedChunks.getFirst());
        }
        if (!analysis.blockEntities.isEmpty()) {
            throw new ApiException(409, "Operation would overwrite " + analysis.blockEntities.size()
                    + " block entities; first: " + analysis.blockEntities.getFirst());
        }
        if (!analysis.players.isEmpty()) {
            throw new ApiException(409, "Operation collides with players: " + String.join(", ", analysis.players));
        }

        var before = analysis.before;

        if (before.isEmpty()) {
            return Map.of("changedBlocks", 0, "message", "All requested blocks already match");
        }

        var changed = new ArrayList<BlockPos>(before.size());
        try {
            for (BlockPos pos : before.keySet()) {
                BlockState target = desired.get(pos);
                if (level.getBlockState(pos) == target) {
                    changed.add(pos);
                    continue;
                }
                if (!level.setBlock(pos, target, 3) && level.getBlockState(pos) != target) {
                    throw new ApiException(409, "Minecraft rejected a block change at " + pos.toShortString());
                }
                changed.add(pos);
            }
        } catch (RuntimeException exception) {
            for (BlockPos pos : changed) level.setBlock(pos, before.get(pos), 3);
            throw exception;
        }

        String transactionLabel = label == null || label.isBlank() ? "blueprint" : label;
        UUID transactionId = UUID.randomUUID();
        Transaction transaction = new Transaction(
                transactionId,
                Instant.now(),
                level.dimension().identifier().toString(),
                before,
                transactionFile(level.getServer(), transactionId),
                transactionLabel,
                normalizeProjectId(projectId)
        );
        try {
            saveTransaction(transaction);
        } catch (IOException exception) {
            for (BlockPos pos : changed) level.setBlock(pos, before.get(pos), 3);
            throw new ApiException(500, "Unable to persist undo transaction; changes were rolled back", exception);
        }
        synchronized (transactions) {
            transactions.addLast(transaction);
            while (transactions.size() > MAX_TRANSACTIONS) deleteTransaction(transactions.removeFirst());
        }

        var result = new LinkedHashMap<String, Object>();
        result.put("transactionId", transaction.id.toString());
        result.put("label", transactionLabel);
        if (transaction.projectId != null) result.put("projectId", transaction.projectId);
        result.put("changedBlocks", before.size());
        result.put("operations", operationCount);
        return result;
    }

    private BlueprintAnalysis analyzeDesired(ServerLevel level, LinkedHashMap<BlockPos, BlockState> desired) {
        var before = new LinkedHashMap<BlockPos, BlockState>();
        var placeMaterials = new LinkedHashMap<String, Integer>();
        var overwriteMaterials = new LinkedHashMap<String, Integer>();
        var unloaded = new java.util.LinkedHashSet<String>();
        var blockEntities = new ArrayList<String>();
        int minX = Integer.MAX_VALUE, minY = Integer.MAX_VALUE, minZ = Integer.MAX_VALUE;
        int maxX = Integer.MIN_VALUE, maxY = Integer.MIN_VALUE, maxZ = Integer.MIN_VALUE;
        for (var entry : desired.entrySet()) {
            BlockPos pos = entry.getKey();
            minX = Math.min(minX, pos.getX());
            minY = Math.min(minY, pos.getY());
            minZ = Math.min(minZ, pos.getZ());
            maxX = Math.max(maxX, pos.getX());
            maxY = Math.max(maxY, pos.getY());
            maxZ = Math.max(maxZ, pos.getZ());
            if (!level.hasChunkAt(pos)) {
                unloaded.add((pos.getX() >> 4) + "," + (pos.getZ() >> 4));
                continue;
            }
            if (level.getBlockEntity(pos) != null && blockEntities.size() < 64) {
                blockEntities.add(pos.toShortString());
            }
            BlockState current = level.getBlockState(pos);
            if (current != entry.getValue()) {
                before.put(pos, current);
                increment(placeMaterials, stateString(entry.getValue()));
                increment(overwriteMaterials, stateString(current));
            }
        }
        var players = new ArrayList<String>();
        for (ServerPlayer player : level.players()) {
            BlockPos feet = player.blockPosition();
            if (desired.containsKey(feet) || desired.containsKey(feet.above())) {
                players.add(player.getGameProfile().name());
            }
        }
        return new BlueprintAnalysis(desired, before,
                new Bounds(new BlockPos(minX, minY, minZ), new BlockPos(maxX, maxY, maxZ)),
                placeMaterials, overwriteMaterials, new ArrayList<>(unloaded), blockEntities, players);
    }

    private static Object previewResponse(BlueprintAnalysis analysis) {
        var hazards = new LinkedHashMap<String, Object>();
        hazards.put("unloadedChunks", analysis.unloadedChunks);
        hazards.put("blockEntities", analysis.blockEntities);
        hazards.put("players", analysis.players);
        return Map.of(
                "dryRun", true,
                "canApply", analysis.unloadedChunks.isEmpty() && analysis.blockEntities.isEmpty()
                        && analysis.players.isEmpty(),
                "bounds", boundsJson(analysis.bounds),
                "requestedBlocks", analysis.desired.size(),
                "changedBlocks", analysis.before.size(),
                "unchangedBlocks", analysis.desired.size() - analysis.before.size(),
                "placeMaterials", analysis.placeMaterials,
                "overwriteMaterials", analysis.overwriteMaterials,
                "hazards", hazards
        );
    }

    private static void increment(Map<String, Integer> counts, String key) {
        counts.merge(key, 1, Integer::sum);
    }

    private static String normalizeProjectId(String projectId) {
        if (projectId == null || projectId.isBlank()) return null;
        if (projectId.length() > 120) throw new ApiException(400, "projectId must be at most 120 characters");
        return projectId;
    }

    private static Map<String, Object> jobStatusResponse(BuildingJob job) {
        var result = new LinkedHashMap<String, Object>();
        result.put("active", true);
        result.put("jobId", job.id.toString());
        result.put("label", job.label);
        if (job.projectId != null) result.put("projectId", job.projectId);
        result.put("status", job.status.name().toLowerCase());
        result.put("completedBlocks", job.progress);
        result.put("totalBlocks", job.blocks.size());
        result.put("percent", Math.round((double) job.progress / job.blocks.size() * 10_000.0) / 100.0);
        result.put("createdAt", job.createdAt.toString());
        if (job.error != null) result.put("error", job.error);
        return result;
    }

    private void completeBuildingJob(BuildingJob job) {
        var before = new LinkedHashMap<BlockPos, BlockState>();
        for (JobBlock block : job.blocks) before.put(block.position, block.before);
        Transaction transaction = new Transaction(job.id, job.createdAt, job.dimension, before,
                transactionFile(minecraftServer, job.id), job.label, job.projectId);
        try {
            saveTransaction(transaction);
        } catch (IOException exception) {
            job.status = JobStatus.PAUSED;
            job.error = "Construction finished but the undo checkpoint could not be finalized";
            saveJobProgress(job);
            McArchitectMod.LOGGER.error("Unable to finalize building job {}", job.id, exception);
            return;
        }
        synchronized (transactions) {
            transactions.addLast(transaction);
            while (transactions.size() > MAX_TRANSACTIONS) deleteTransaction(transactions.removeFirst());
        }
        deleteBuildingJobFiles(job);
        buildingJob = null;
    }

    private Object cancelBuildingJob(BuildingJob job) {
        ServerLevel level = findLevel(job.dimension);
        int restored = 0;
        for (int index = job.blocks.size() - 1; index >= 0; index--) {
            JobBlock block = job.blocks.get(index);
            if (level.getBlockState(block.position) == block.after) {
                level.setBlock(block.position, block.before, 3);
                restored++;
            }
        }
        deleteBuildingJobFiles(job);
        buildingJob = null;
        return Map.of("jobId", job.id.toString(), "cancelled", true, "restoredBlocks", restored);
    }

    private static Path jobDirectory(MinecraftServer server) {
        return server.getWorldPath(LevelResource.ROOT).resolve("mcarchitect").resolve("jobs");
    }

    private static Path jobPlanFile(MinecraftServer server, UUID id) {
        return jobDirectory(server).resolve(id + ".json.gz");
    }

    private static Path jobProgressFile(MinecraftServer server, UUID id) {
        return jobDirectory(server).resolve(id + ".progress.json");
    }

    private static void saveJobPlan(BuildingJob job) throws IOException {
        Files.createDirectories(job.planFile.getParent());
        List<PersistedJobBlock> blocks = job.blocks.stream().map(block -> new PersistedJobBlock(
                block.position.getX(), block.position.getY(), block.position.getZ(),
                stateString(block.before), stateString(block.after))).toList();
        PersistedJob plan = new PersistedJob(job.id.toString(), job.createdAt.toEpochMilli(), job.dimension,
                job.label, job.projectId, blocks);
        Path temporary = job.planFile.resolveSibling(job.planFile.getFileName() + ".tmp");
        try (var output = new GZIPOutputStream(Files.newOutputStream(temporary))) {
            output.write(GSON.toJson(plan).getBytes(StandardCharsets.UTF_8));
        }
        Files.move(temporary, job.planFile, java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                java.nio.file.StandardCopyOption.ATOMIC_MOVE);
    }

    private static void writeJobProgress(BuildingJob job) throws IOException {
        Files.createDirectories(job.progressFile.getParent());
        PersistedJobProgress progress = new PersistedJobProgress(job.progress,
                job.status.name().toLowerCase(), job.error);
        Path temporary = job.progressFile.resolveSibling(job.progressFile.getFileName() + ".tmp");
        Files.writeString(temporary, GSON.toJson(progress), StandardCharsets.UTF_8);
        Files.move(temporary, job.progressFile, java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                java.nio.file.StandardCopyOption.ATOMIC_MOVE);
    }

    private static void saveJobProgress(BuildingJob job) {
        try {
            writeJobProgress(job);
        } catch (IOException exception) {
            McArchitectMod.LOGGER.error("Unable to save building job {} progress", job.id, exception);
        }
    }

    private void loadBuildingJob(MinecraftServer server) {
        Path directory = jobDirectory(server);
        if (!Files.isDirectory(directory)) return;
        try (var paths = Files.list(directory)) {
            Optional<Path> planPath = paths.filter(path -> path.getFileName().toString().endsWith(".json.gz"))
                    .sorted().findFirst();
            if (planPath.isEmpty()) return;
            try (var input = new GZIPInputStream(Files.newInputStream(planPath.get()))) {
                PersistedJob plan = GSON.fromJson(new String(input.readAllBytes(), StandardCharsets.UTF_8),
                        PersistedJob.class);
                UUID id = UUID.fromString(plan.id);
                Path progressPath = jobProgressFile(server, id);
                PersistedJobProgress progress = Files.isRegularFile(progressPath)
                        ? GSON.fromJson(Files.readString(progressPath, StandardCharsets.UTF_8), PersistedJobProgress.class)
                        : new PersistedJobProgress(0, "paused", "Recovered without a progress file");
                List<JobBlock> blocks = plan.blocks.stream().map(block -> new JobBlock(
                        new BlockPos(block.x, block.y, block.z), parseBlockState(block.before),
                        parseBlockState(block.after))).toList();
                buildingJob = new BuildingJob(id, Instant.ofEpochMilli(plan.createdAt), plan.dimension,
                        plan.label, plan.projectId, blocks, Math.max(0, Math.min(progress.progress, blocks.size())),
                        JobStatus.PAUSED, "Recovered after restart; resume explicitly",
                        planPath.get(), progressPath);
                saveJobProgress(buildingJob);
                McArchitectMod.LOGGER.info("Recovered paused MC Architect building job {}", id);
            }
        } catch (Exception exception) {
            McArchitectMod.LOGGER.error("Unable to recover MC Architect building job", exception);
        }
    }

    private static void deleteBuildingJobFiles(BuildingJob job) {
        try {
            Files.deleteIfExists(job.planFile);
            Files.deleteIfExists(job.progressFile);
        } catch (IOException exception) {
            McArchitectMod.LOGGER.warn("Unable to delete building job files for {}", job.id, exception);
        }
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

    private static BlockState parseBlockState(String specification) {
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

    private static String stateString(BlockState state) {
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

    private Object undo(HttpExchange exchange) {
        UndoRequest request = readOptionalBody(exchange, UndoRequest.class).orElse(new UndoRequest());
        return onServer(() -> undoLatest(request.transactionId, request.projectId));
    }

    private Object listTransactions(HttpExchange ignored) {
        synchronized (transactions) {
            var result = new ArrayList<Map<String, Object>>();
            var iterator = transactions.descendingIterator();
            while (iterator.hasNext()) {
                Transaction transaction = iterator.next();
                var item = new LinkedHashMap<String, Object>();
                item.put("transactionId", transaction.id.toString());
                item.put("label", transaction.label);
                if (transaction.projectId != null) item.put("projectId", transaction.projectId);
                item.put("createdAt", transaction.createdAt.toString());
                item.put("dimension", transaction.dimension);
                item.put("changedBlocks", transaction.before.size());
                result.add(item);
            }
            return Map.of("transactions", result);
        }
    }

    private Object undoLatest(String requestedId, String requestedProjectId) {
        if (buildingJob != null) {
            throw new ApiException(409, "A background building job is active; cancel or complete it before undo");
        }
        if (requestedId != null && requestedProjectId != null) {
            throw new ApiException(400, "Specify transactionId or projectId, not both");
        }
        List<Transaction> selected = new ArrayList<>();
        synchronized (transactions) {
            Transaction latest = transactions.peekLast();
            if (latest == null) {
                throw new ApiException(409, "There is no transaction to undo");
            }
            if (requestedId != null && !latest.id.toString().equals(requestedId)) {
                throw new ApiException(409, "Only the newest transaction can be undone safely");
            }
            if (requestedProjectId != null) {
                if (!requestedProjectId.equals(latest.projectId)) {
                    throw new ApiException(409, "Only the newest contiguous project can be undone safely");
                }
                var iterator = transactions.descendingIterator();
                while (iterator.hasNext()) {
                    Transaction transaction = iterator.next();
                    if (!requestedProjectId.equals(transaction.projectId)) break;
                    selected.add(transaction);
                }
            } else {
                selected.add(latest);
            }
        }

        var rollback = new ArrayList<UndoChange>();
        int restoredBlocks = 0;
        try {
            for (Transaction transaction : selected) {
                ServerLevel level = findLevel(transaction.dimension);
                for (var entry : transaction.before.entrySet()) {
                    BlockState current = level.getBlockState(entry.getKey());
                    if (current == entry.getValue()) continue;
                    if (!level.setBlock(entry.getKey(), entry.getValue(), 3)
                            && level.getBlockState(entry.getKey()) != entry.getValue()) {
                        throw new ApiException(409, "Minecraft rejected an undo change at "
                                + entry.getKey().toShortString());
                    }
                    rollback.add(new UndoChange(level, entry.getKey(), current));
                    restoredBlocks++;
                }
            }
        } catch (RuntimeException exception) {
            for (int index = rollback.size() - 1; index >= 0; index--) {
                UndoChange change = rollback.get(index);
                change.level.setBlock(change.position, change.state, 3);
            }
            throw exception;
        }
        synchronized (transactions) {
            for (Transaction transaction : selected) {
                if (transactions.peekLast() != transaction) {
                    throw new ApiException(409, "Transaction stack changed while undo was running");
                }
                transactions.removeLast();
            }
        }
        selected.forEach(ArchitectHttpServer::deleteTransaction);
        var result = new LinkedHashMap<String, Object>();
        result.put("transactionId", selected.getFirst().id.toString());
        if (requestedProjectId != null) result.put("projectId", requestedProjectId);
        result.put("transactionsUndone", selected.size());
        result.put("restoredBlocks", restoredBlocks);
        return result;
    }

    private ServerLevel findLevel(String dimension) {
        MinecraftServer server = minecraftServer;
        if (server == null) throw new ApiException(409, "No single-player world is open");
        for (ServerLevel level : server.getAllLevels()) {
            if (level.dimension().identifier().toString().equals(dimension)) return level;
        }
        throw new ApiException(409, "Transaction dimension is not available: " + dimension);
    }

    private static Path transactionFile(MinecraftServer server, UUID id) {
        return server.getWorldPath(LevelResource.ROOT)
                .resolve("mcarchitect").resolve("transactions").resolve(id + ".json.gz");
    }

    private static void saveTransaction(Transaction transaction) throws IOException {
        Files.createDirectories(transaction.file.getParent());
        List<PersistedBlock> blocks = transaction.before.entrySet().stream()
                .map(entry -> new PersistedBlock(
                        entry.getKey().getX(), entry.getKey().getY(), entry.getKey().getZ(), stateString(entry.getValue())))
                .toList();
        PersistedTransaction persisted = new PersistedTransaction(
                transaction.id.toString(), transaction.createdAt.toEpochMilli(), transaction.dimension,
                transaction.label, transaction.projectId, blocks
        );
        Path temporary = transaction.file.resolveSibling(transaction.file.getFileName() + ".tmp");
        try (var output = new GZIPOutputStream(Files.newOutputStream(temporary))) {
            output.write(GSON.toJson(persisted).getBytes(StandardCharsets.UTF_8));
        }
        Files.move(temporary, transaction.file, java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                java.nio.file.StandardCopyOption.ATOMIC_MOVE);
    }

    private void loadTransactions(MinecraftServer server) {
        Path directory = server.getWorldPath(LevelResource.ROOT).resolve("mcarchitect").resolve("transactions");
        if (!Files.isDirectory(directory)) return;
        try (var paths = Files.list(directory)) {
            List<Transaction> loaded = paths.filter(path -> path.getFileName().toString().endsWith(".json.gz"))
                    .map(path -> loadTransaction(path, server))
                    .flatMap(Optional::stream)
                    .sorted(Comparator.comparing(Transaction::createdAt))
                    .toList();
            synchronized (transactions) {
                for (Transaction transaction : loaded) transactions.addLast(transaction);
                while (transactions.size() > MAX_TRANSACTIONS) deleteTransaction(transactions.removeFirst());
            }
            McArchitectMod.LOGGER.info("Loaded {} persistent MC Architect undo transactions", transactions.size());
        } catch (IOException exception) {
            McArchitectMod.LOGGER.error("Unable to load persistent MC Architect transactions", exception);
        }
    }

    private static Optional<Transaction> loadTransaction(Path path, MinecraftServer server) {
        try (var input = new GZIPInputStream(Files.newInputStream(path))) {
            PersistedTransaction persisted = GSON.fromJson(
                    new String(input.readAllBytes(), StandardCharsets.UTF_8), PersistedTransaction.class);
            UUID id = UUID.fromString(persisted.id);
            var before = new LinkedHashMap<BlockPos, BlockState>();
            for (PersistedBlock block : persisted.before) {
                before.put(new BlockPos(block.x, block.y, block.z), parseBlockState(block.state));
            }
            return Optional.of(new Transaction(id, Instant.ofEpochMilli(persisted.createdAt),
                    persisted.dimension, before, path, persisted.label, persisted.projectId));
        } catch (Exception exception) {
            McArchitectMod.LOGGER.error("Ignoring invalid transaction file {}", path, exception);
            return Optional.empty();
        }
    }

    private static void deleteTransaction(Transaction transaction) {
        try {
            Files.deleteIfExists(transaction.file);
        } catch (IOException exception) {
            McArchitectMod.LOGGER.warn("Unable to delete transaction file {}", transaction.file, exception);
        }
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

    private record Transaction(UUID id, Instant createdAt, String dimension, Map<BlockPos, BlockState> before,
                               Path file, String label, String projectId) {}

    private record PersistedTransaction(String id, long createdAt, String dimension, String label,
                                        String projectId, List<PersistedBlock> before) {}

    private record PersistedBlock(int x, int y, int z, String state) {}

    private static final class FillRequest {
        PositionRequest from;
        PositionRequest to;
        String block;
    }

    private static final class ApplyRequest {
        List<FillRequest> operations;
        String label;
        String projectId;
        boolean dryRun;
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

    private static final class TransformRequest extends RegionRequest {
        PositionRequest target;
        Integer rotation;
        String mirror;
        Integer copies;
        PositionRequest spacing;
        Boolean includeAir;
        String label;
        String projectId;
        boolean dryRun;
    }

    private static final class ReplaceRequest extends RegionRequest {
        List<String> match;
        String block;
        String label;
        String projectId;
        boolean dryRun;
    }

    private static final class JobRequest {
        List<FillRequest> operations;
        String label;
        String projectId;
    }

    private static final class JobControlRequest {
        String jobId;
        String action;
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

    private static final class UndoRequest {
        String transactionId;
        String projectId;
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

    private record BlueprintAnalysis(LinkedHashMap<BlockPos, BlockState> desired,
                                     LinkedHashMap<BlockPos, BlockState> before, Bounds bounds,
                                     Map<String, Integer> placeMaterials,
                                     Map<String, Integer> overwriteMaterials,
                                     List<String> unloadedChunks, List<String> blockEntities,
                                     List<String> players) {}

    private record UndoChange(ServerLevel level, BlockPos position, BlockState state) {}

    private record JobBlock(BlockPos position, BlockState before, BlockState after) {}

    private record PersistedJob(String id, long createdAt, String dimension, String label,
                                String projectId, List<PersistedJobBlock> blocks) {}

    private record PersistedJobBlock(int x, int y, int z, String before, String after) {}

    private record PersistedJobProgress(int progress, String status, String error) {}

    private enum JobStatus { RUNNING, PAUSED }

    private static final class BuildingJob {
        final UUID id;
        final Instant createdAt;
        final String dimension;
        final String label;
        final String projectId;
        final List<JobBlock> blocks;
        int progress;
        JobStatus status;
        String error;
        final Path planFile;
        final Path progressFile;

        BuildingJob(UUID id, Instant createdAt, String dimension, String label, String projectId,
                    List<JobBlock> blocks, int progress, JobStatus status, String error,
                    Path planFile, Path progressFile) {
            this.id = id;
            this.createdAt = createdAt;
            this.dimension = dimension;
            this.label = label;
            this.projectId = projectId;
            this.blocks = blocks;
            this.progress = progress;
            this.status = status;
            this.error = error;
            this.planFile = planFile;
            this.progressFile = progressFile;
        }
    }

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
