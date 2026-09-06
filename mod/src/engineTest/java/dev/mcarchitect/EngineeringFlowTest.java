package dev.mcarchitect;

import com.google.gson.JsonObject;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** Construction workflow checks; no Minecraft save or JUnit runtime required. */
public final class EngineeringFlowTest {
    static int passed;
    static final String AIR = "minecraft:air", STONE = "minecraft:stone", GOLD = "minecraft:gold_block";
    static final class FakeWorld implements ProjectWorld {
        final Map<String, String> blocks = new HashMap<>();
        int tickets, maxTickets, writes;
        boolean delayed, hazard;
        long writeDelay;
        String identity = "test-world";
        @Override public String worldId() { return identity; }
        @Override public String dimension() { return "minecraft:overworld"; }
        @Override public String canonical(String specification) { return specification; }
        @Override public void validateHeight(int min, int max) { check(min >= -64 && max < 320, "height"); }
        @Override public CompletableFuture<?> loadChunk(int x, int z) {
            maxTickets = Math.max(maxTickets, ++tickets);
            return delayed ? new CompletableFuture<>() : CompletableFuture.completedFuture(true);
        }
        @Override public void releaseChunk(int x, int z) { tickets--; }
        @Override public String read(int x, int y, int z) { return blocks.getOrDefault(x + "," + y + "," + z, AIR); }
        @Override public void checkWritable(int x, int y, int z) { if (hazard) throw new IllegalStateException("Player entered work area"); }
        @Override public void write(int x, int y, int z, String state) {
            if (writeDelay > 0) java.util.concurrent.locks.LockSupport.parkNanos(writeDelay);
            blocks.put(x + "," + y + "," + z, state); writes++;
        }
    }
    record Fixture(ProjectStore store, FakeWorld world, String id, ProjectBuildService service, List<String> data) {}
    static Fixture fixture(List<ProjectStore.Section> sections) throws Exception {
        Path base = Path.of("build", "project-engine-test").toAbsolutePath(); Files.createDirectories(base);
        var store = new ProjectStore(Files.createTempDirectory(base, "case-").resolve("projects"));
        var world = new FakeWorld(); var service = new ProjectBuildService(store, world);
        List<String> data = sections.stream().map(ProjectStore.JSON::toJson).toList();
        String id = ProjectStore.hash(ProjectStore.JSON.toJson(List.of("test-project", "test-world", "minecraft:overworld"))
                + "\n" + String.join("\n", data.stream().map(ProjectStore::hash).toList()));
        JsonObject open = request("open", id); open.addProperty("projectId", "test-project"); open.addProperty("worldId", "test-world");
        open.addProperty("dimension", "minecraft:overworld"); open.addProperty("sectionCount", sections.size());
        service.request(open).join();
        for (int i = 0; i < data.size(); i++) {
            JsonObject upload = request("upload", id); upload.addProperty("index", i); upload.addProperty("data", data.get(i));
            service.request(upload).join();
        }
        return new Fixture(store, world, id, service, data);
    }
    static ProjectStore.Section solid(int x) { return new ProjectStore.Section(x, 4, 0, Arrays.asList(null, STONE), new int[] { 1, 4096 }); }
    static JsonObject request(String action, String id) {
        JsonObject request = new JsonObject(); request.addProperty("action", action); request.addProperty("planId", id); return request;
    }
    static JsonObject status(ProjectBuildService service) { return ProjectStore.JSON.toJsonTree(service.status()).getAsJsonObject(); }
    static void start(ProjectBuildService service, String id, String action, int maximum) {
        JsonObject request = request(action, id); request.addProperty("maxBlocksPerTick", maximum); service.request(request).join();
    }
    static void until(ProjectBuildService service, java.util.function.BooleanSupplier condition) throws Exception {
        for (int i = 0; i < 40000; i++) {
            service.tick();
            if (condition.getAsBoolean()) return;
            Thread.sleep(1);
        }
        throw new AssertionError("Timed out: " + status(service));
    }
    static void complete(ProjectBuildService service) throws Exception {
        until(service, () -> !status(service).get("active").getAsBoolean() || status(service).get("status").getAsString().equals("paused"));
        check(!status(service).get("active").getAsBoolean(), "Unexpected pause: " + status(service));
    }
    static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    interface Checked { void run() throws Exception; }
    static void test(String name, Checked test) throws Exception { test.run(); passed++; System.out.println("PASS " + name); }
    public static void main(String[] args) throws Exception {
        test("sparse section KEEP cells do not consume the world-access quota", () -> {
            var f=fixture(List.of(new ProjectStore.Section(0,4,0,Arrays.asList(null,STONE),new int[]{0,4095,1,1})));
            start(f.service,f.id,"start",1); int scanTicks=0;
            for(int i=0;i<40000 && status(f.service).get("active").getAsBoolean();i++) {
                String stage=status(f.service).get("stage").getAsString();
                if(stage.equals("snapshot")||stage.equals("verify"))scanTicks++;
                f.service.tick();Thread.sleep(1);
            }
            check(!status(f.service).get("active").getAsBoolean() && f.world.writes==1,"sparse placement failed");
            check(scanTicks<12,"empty cells exhausted the work quota: "+scanTicks);
            start(f.service,f.id,"rollback",1);complete(f.service);
            check(f.world.read(15,79,15).equals(AIR),"sparse rollback failed");f.service.close();
        });
        test("keyboard accepts decimal and hex assembly and rejects invalid programs before execution", () -> {
            var words=KeyboardProgram.parse("LDI 0x25\nADDI 19; OUT\nHLT");
            check(words.size()==8 && words.get(0).value()==37 && words.get(1).op().equals("ADD") && words.get(7).code()==3,"assembly and padding");
            for(String bad:List.of("LDI -1","LDI 256","JMP 0","ADD","LDI 1 extra","HLT;HLT;HLT;HLT;HLT;HLT;HLT;HLT;HLT")) {
                boolean rejected=false;try { KeyboardProgram.parse(bad); } catch(IllegalArgumentException expected) {rejected=true;} check(rejected,"accepted invalid program: "+bad);
            }
        });
        test("wire solver preserves decay, feedback clearing and competing sources without mutating snapshots", () -> {
            int[][] graph = {{1}, {0, 2}, {1, 3}, {2}};
            int[] source = {15, 0, 0, 15};
            check(Arrays.equals(WireNetworkSolver.solve(graph, source), new int[]{15,14,14,15}), "multiple drivers");
            check(Arrays.equals(source, new int[]{15,0,0,15}), "worker mutated snapshot");
            check(Arrays.equals(WireNetworkSolver.solve(graph, new int[4]), new int[4]), "feedback retained stale power");
            check(Arrays.equals(WireNetworkSolver.solve(new int[][]{{1},{2},{3},{}}, new int[]{3,0,0,0}), new int[]{3,2,1,0}), "attenuation");
        });
        test("parallel wire jobs match independent fixed-point reference on directed stair networks", () -> {
            var random = new Random(719);
            var pool = Executors.newFixedThreadPool(4);
            try {
                var tasks = new ArrayList<Future<?>>();
                for (int trial = 0; trial < 80; trial++) {
                    int width = 32 + random.nextInt(256); int[][] graph = new int[width][]; int[] sources = new int[width];
                    for (int i=0;i<width;i++) {
                        graph[i] = random.ints(4,0,width).toArray();
                        sources[i] = random.nextInt(12)==0 ? random.nextInt(16) : 0;
                    }
                    tasks.add(pool.submit(() -> {
                        int[] reference = sources.clone();
                        for(int round=0;round<16;round++) {
                            int[] next=reference.clone();
                            for(int i=0;i<width;i++) for(int target:graph[i]) next[target]=Math.max(next[target],reference[i]-1);
                            reference=next;
                        }
                        check(Arrays.equals(WireNetworkSolver.solve(graph,sources),reference), "parallel/reference mismatch");
                    }));
                }
                for (var task:tasks) task.get();
            } finally { pool.shutdownNow(); }
        });
        test("mid-section crash and unsaved chunks recover using the original before-image", () -> {
            var f = fixture(List.of(solid(0), solid(20)));
            start(f.service, f.id, "start", 64); until(f.service, () -> f.world.writes >= 64);
            f.service.close(); f.world.blocks.clear();
            var recovered = new ProjectBuildService(f.store, f.world);
            start(recovered, f.id, "resume", 8192); complete(recovered);
            check(f.world.blocks.values().stream().filter(STONE::equals).count() == 8192, "lost blocks after crash");
            start(recovered, f.id, "rollback", 8192); complete(recovered);
            check(f.world.blocks.values().stream().noneMatch(STONE::equals), "resnapshot corrupted undo"); recovered.close();
        });
        test("external changes pause construction and rollback without overwriting the changed block", () -> {
            var f = fixture(List.of(solid(0)));
            start(f.service, f.id, "start", 64); until(f.service, () -> f.world.writes >= 64); f.service.close();
            f.world.blocks.put("0,64,0", GOLD);
            var recovered = new ProjectBuildService(f.store, f.world);
            start(recovered, f.id, "resume", 8192); until(recovered, () -> status(recovered).has("error"));
            check(f.world.read(0,64,0).equals(GOLD), "overwrote external edit");
            start(recovered, f.id, "rollback", 8192); until(recovered, () -> status(recovered).has("error"));
            check(f.world.read(0,64,0).equals(GOLD), "rollback overwrote external edit");
            recovered.close(); f.world.blocks.put("0,64,0", STONE);
            var again = new ProjectBuildService(f.store, f.world);
            start(again, f.id, "resume", 8192); complete(again);
            check(status(again).get("status").getAsString().equals("rolled_back"), "lost rollback direction on restart");
            check(f.world.blocks.values().stream().noneMatch(STONE::equals), "rollback incomplete"); again.close();
        });
        test("asynchronous chunk loading does not block ticks and pause releases its ticket", () -> {
            var f = fixture(List.of(solid(0))); f.world.delayed = true;
            start(f.service, f.id, "start", 8192); until(f.service, () -> status(f.service).get("stage").getAsString().equals("chunk"));
            for (int i = 0; i < 20; i++) f.service.tick();
            check(f.world.writes == 0, "wrote unloaded chunk"); f.service.request(request("pause", f.id)).join();
            check(f.world.tickets == 0, "pending load ticket leaked");
            f.world.delayed = false; start(f.service, f.id, "resume", 8192); complete(f.service); f.service.close();
        });
        test("soft time budget yields after an expensive individual placement", () -> {
            var f = fixture(List.of(new ProjectStore.Section(0,4,0,Arrays.asList(null,STONE),new int[] {1,20,0,4076})));
            f.world.writeDelay = 2_000_000;
            JsonObject request = request("start", f.id); request.addProperty("tickBudgetMs", 0.25); request.addProperty("maxBlocksPerTick", 8192);
            f.service.request(request).join();
            int[] priorWrites = { 0 };
            until(f.service, () -> {
                check(f.world.writes - priorWrites[0] <= 1, "time budget failed to yield after an expensive write");
                priorWrites[0] = f.world.writes;
                return !status(f.service).get("active").getAsBoolean();
            });
            check(f.world.writes == 20, "incomplete budgeted build"); f.service.close();
        });
        test("TypeScript prepared fixtures are accepted by the Java content hash and RLE decoder", () -> {
            Path source = Path.of("..", "bridge", "test", "fixtures", "prepared-project");
            var header = ProjectStore.JSON.fromJson(Files.readString(source.resolve("manifest.json")), ProjectStore.Header.class);
            Path base = Path.of("build", "project-engine-test").toAbsolutePath(); Files.createDirectories(base);
            var store = new ProjectStore(Files.createTempDirectory(base, "typescript-")); store.open(header);
            for (int i = 0; i < header.sectionCount(); i++) {
                store.upload(header.planId(), i, Files.readString(source.resolve("sections").resolve(String.format(Locale.ROOT, "%08d.json", i))));
            }
            store.seal(header.planId());
            var world = new FakeWorld(); var service = new ProjectBuildService(store, world);
            start(service, header.planId(), "start", 8192); complete(service);
            check(world.read(-1,64,0).equals("minecraft:stone_bricks") && world.read(0,64,0).equals(AIR)
                    && world.read(1,64,0).equals("minecraft:stone_bricks"), "cross-language output differs"); service.close();
        });
        test("ordered module deployment completes and rolls back across service restart", () -> {
            var f = fixture(List.of(solid(0))); var second = fixture(List.of(solid(1)));
            f.store.open(second.store.readHeader(second.id)); f.store.upload(second.id, 0, second.data.getFirst()); second.service.close();
            String id = ProjectStore.hash(f.id + "\n" + second.id);
            var spec = new AssemblyBuildService.Spec(id, "test-world", "minecraft:overworld", List.of(
                    new AssemblyBuildService.Step("support", f.id), new AssemblyBuildService.Step("logic", second.id)));
            var service = new AssemblyBuildService(f.store, f.service, f.world);
            var req = ProjectStore.JSON.toJsonTree(spec).getAsJsonObject(); req.addProperty("action", "start"); service.request(req).join();
            for (int i = 0; i < 10000 && service.ownsWriter(); i++) { f.service.tick(); service.tick(); Thread.sleep(1); }
            check(ProjectStore.JSON.toJsonTree(service.status()).getAsJsonObject().get("status").getAsString().equals("complete"), "stage deployment: " + service.status());
            check(f.world.writes == 8192, "missing stage"); service.close(); f.service.close();
            var projects = new ProjectBuildService(f.store, f.world); var resumed = new AssemblyBuildService(f.store, projects, f.world);
            req.addProperty("action", "rollback"); resumed.request(req).join();
            for (int i = 0; i < 10000 && resumed.ownsWriter(); i++) { projects.tick(); resumed.tick(); Thread.sleep(1); }
            check(f.world.blocks.values().stream().noneMatch(STONE::equals), "assembly rollback"); resumed.close(); projects.close();
        });
        test("signal stimulus, observation and input recovery form one usable debug session", () -> {
            var host = new CircuitWorld() {
                long tick; boolean powered; int tickets;
                public String worldId() { return "test-world"; }
                public String dimension() { return "minecraft:overworld"; }
                public long gameTick() { return tick; }
                public CompletableFuture<?> load(CircuitTestService.Spec spec) { tickets++; return CompletableFuture.completedFuture(true); }
                public void release() { tickets = 0; }
                public String inputState(CircuitTestService.Input input) { return String.valueOf(powered); }
                public void drive(CircuitTestService.Input input, boolean value, String before) { powered = value; }
                public void restore(CircuitTestService.Input input, String before) { powered = Boolean.parseBoolean(before); }
                public int sample(CircuitTestService.Probe probe) { return powered ? 15 : 0; }
            };
            var p = new CircuitTestService.Point(0,64,0); String id = UUID.randomUUID().toString();
            var spec = new CircuitTestService.Spec(id,"signal session","test-world","minecraft:overworld",new CircuitTestService.Bounds(p,p),
                    List.of(new CircuitTestService.Input("in",p)),List.of(new CircuitTestService.Probe("out",p,"wire")),
                    List.of(new CircuitTestService.Event(0,Map.of("in",true))),List.of(new CircuitTestService.Assertion(2,"out",1,15)),4,1);
            Path root = Files.createTempDirectory("mcengineer-circuit-"); var service = new CircuitTestService(host,root);
            var req = ProjectStore.JSON.toJsonTree(spec).getAsJsonObject(); req.addProperty("action","start"); service.request(req).join();
            for (int i=0;i<10000 && service.ownsWriter();i++) { host.tick++; service.tick(); Thread.sleep(1); }
            check(ProjectStore.JSON.toJsonTree(service.status()).getAsJsonObject().get("passed").getAsBoolean(),"signal result: "+service.status());
            check(!host.powered && host.tickets==0 && Files.exists(root.resolve(id).resolve("trace.json")),"input/trace cleanup");
            host.powered=true; service.close(); var recovery=new CircuitTestService(host,root);req.addProperty("action","restore");recovery.request(req).join();
            for(int i=0;i<10000 && recovery.ownsWriter();i++){host.tick++;recovery.tick();Thread.sleep(1);}
            check(!host.powered && host.tickets==0,"durable input restore");recovery.close();
            var keyboard=new CircuitTestService(host,root);String keyboardId=UUID.randomUUID().toString();
            req.addProperty("id",keyboardId);req.addProperty("action","start");req.addProperty("retainInputs",true);keyboard.request(req).join();
            for(int i=0;i<10000&&keyboard.ownsWriter();i++){host.tick++;keyboard.tick();Thread.sleep(1);}
            check(host.powered && !Files.exists(root.resolve(keyboardId).resolve("before.json")),"interactive success did not retain controls");
            host.powered=false;keyboardId=UUID.randomUUID().toString();req.addProperty("id",keyboardId);
            req.add("assertions",ProjectStore.JSON.toJsonTree(List.of(new CircuitTestService.Assertion(2,"out",0,0))));keyboard.request(req).join();
            for(int i=0;i<10000&&keyboard.ownsWriter();i++){host.tick++;keyboard.tick();Thread.sleep(1);}
            check(!host.powered && ProjectStore.JSON.toJsonTree(keyboard.status()).getAsJsonObject().get("status").getAsString().equals("failed"),"failed interactive operation retained controls");keyboard.close();
        });
        System.out.println("Engineering: " + passed + " workflow checks passed");
    }
}
