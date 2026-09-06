package dev.mcarchitect;

import com.google.gson.JsonObject;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.Supplier;
import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.block.RedStoneWireBlock;
import net.minecraft.world.level.block.ButtonBlock;
import net.minecraft.world.level.block.LeverBlock;

/** User controls share the tested physical-button stimulus engine. */
final class ComputerKeyboardService {
    private final CircuitTestService circuits;
    private final MinecraftServer server;
    private final Supplier<ServerPlayer> player;
    private final Path path;
    private JsonObject profile;
    private String operationId, operation = "idle";
    private JsonObject lastCircuit;
    private final ArrayDeque<Map<String,Object>> history = new ArrayDeque<>();
    private Map<String,Integer> previous = Map.of();
    ComputerKeyboardService(CircuitTestService circuits, MinecraftServer server, Supplier<ServerPlayer> player, Path path) {
        this.circuits=circuits; this.server=server; this.player=player; this.path=path;
        try { if(Files.exists(path)) {
            profile=ProjectStore.JSON.fromJson(Files.readString(path),JsonObject.class);
            if(profile.has("operationId")) {
                operationId=profile.get("operationId").getAsString(); UUID.fromString(operationId);
                Path result=path.getParent().resolve("tests").resolve(operationId).resolve("result.json");
                if(Files.exists(result))lastCircuit=ProjectStore.JSON.fromJson(Files.readString(result),JsonObject.class);
            }
        } }
        catch(Exception e) { McArchitectMod.LOGGER.warn("Keyboard profile could not be loaded",e); }
    }
    private void save() {
        try { ProjectStore.atomicWrite(path,ProjectStore.JSON.toJson(profile).getBytes(StandardCharsets.UTF_8)); }
        catch(Exception e) { throw new IllegalStateException("键盘设置保存失败",e); }
    }
    private void requireBinding() {
        if(profile==null) throw new IllegalStateException("当前世界尚未绑定红石计算机");
        if(!profile.get("worldId").getAsString().equals(MinecraftProjectWorld.identity(server)) || !profile.get("dimension").getAsString().equals(player.get().level().dimension().identifier().toString())) throw new IllegalStateException("键盘绑定的世界或维度不匹配");
    }
    void requireAvailable() { live(); }
    Object request(JsonObject r) {
        String action=r.get("action").getAsString();
        if(action.equals("status")) return status();
        if(action.equals("bind")) {
            if(circuits.ownsWriter()) throw new IllegalStateException("请等待当前操作结束");
            JsonObject candidate=r.getAsJsonObject("profile");
            if(candidate==null || !candidate.has("inputs") || !candidate.has("probes") || !candidate.has("bounds")) throw new IllegalArgumentException("Incomplete keyboard profile");
            JsonObject old=profile; profile=candidate.deepCopy();
            try { requireBinding(); var template=ProjectStore.JSON.fromJson(profile,CircuitTestService.Spec.class); if(template.inputs().size()>64 || template.probes().size()>64) throw new IllegalArgumentException("Too many ports"); }
            catch(RuntimeException e) { profile=old; throw e; }
            operationId=null;lastCircuit=null;history.clear();previous=Map.of();save();return status();
        }
        requireBinding();
        if(action.equals("draft")) {profile.addProperty("draft",r.get("program").getAsString());save();return Map.of("saved",true);}
        if(action.equals("cancel") || action.equals("restore")) {
            if(operationId==null) throw new IllegalStateException("没有需要恢复的操作");
            JsonObject q=new JsonObject(); q.addProperty("action",action); q.addProperty("id",operationId); return circuits.request(q).join();
        }
        requireAvailable();
        if(circuits.ownsWriter()) throw new IllegalStateException("当前操作进行中，请等待或取消");
        var events=new ArrayList<CircuitTestService.Event>();
        var assertions=new ArrayList<CircuitTestService.Assertion>();
        int duration;
        switch(action) {
            case "write", "write-run" -> {
                String text=r.get("program").getAsString(); var words=KeyboardProgram.parse(text);
                int input=r.has("input")?KeyboardProgram.number(r.get("input").getAsString()):0;
                event(events,0,"cpu.run",false,"cpu.manual",false,"cpu.reset",true,"cpu.view",false,"io.carryIn",false);
                event(events,1000,"cpu.reset",false);
                for(int i=0;i<8;i++) {
                    var word=words.get(i); int t=200+i*2000, encoded=word.value()|(word.code()<<8);
                    event(events,t,"key_addr_"+i+".press",true,"key_op_"+word.code()+".press",true,"key_hi_"+(word.value()>>4)+".press",true,"key_lo_"+(word.value()&15)+".press",true);
                    event(events,t+1000,"cpu.store",true);
                    assertBus(assertions,t+700,"terminal.entry",11,encoded);
                    assertBus(assertions,t+700,"terminal.address",3,i);
                    assertBus(assertions,t+1800,"terminal.read",11,encoded);
                }
                event(events,16200,"key_addr_0.press",true,"cpu.view",true);
                duration=18000;
                if(action.equals("write-run")) {
                    event(events,18000,"cpu.reset",true,"key_hi_"+(input>>4)+".press",true,"key_lo_"+(input&15)+".press",true);
                    event(events,19000,"cpu.reset",false); event(events,22000,"cpu.run",true); duration=22001;
                }
                profile.addProperty("program",String.join("\n",words.stream().map(w->w.op()+" "+w.value()).toList()));
            }
            case "run", "reset" -> {
                event(events,0,"cpu.run",false,"cpu.manual",false,"cpu.reset",true,"io.carryIn",false);
                event(events,1000,"cpu.reset",false); duration=4001;
                if(action.equals("run")) event(events,4000,"cpu.run",true);
            }
            case "stop" -> { event(events,0,"cpu.run",false,"cpu.manual",false); duration=2000; }
            case "step" -> {
                int pc=live().getOrDefault("cpu.pc",0);
                event(events,0,"cpu.run",false,"cpu.manual",false,"key_addr_"+pc+".press",true,"cpu.view",true);
                // Modular RAM/address routes need to settle before the clock opens the accumulator.
                event(events,3000,"cpu.manual",true); event(events,5000,"cpu.manual",false); duration=7000;
            }
            case "input" -> {
                int value=KeyboardProgram.number(r.get("input").getAsString());
                event(events,0,"key_hi_"+(value>>4)+".press",true,"key_lo_"+(value&15)+".press",true); duration=1200;
            }
            default -> throw new IllegalArgumentException("Unknown keyboard action");
        }
        JsonObject spec=profile.deepCopy(); operationId=UUID.randomUUID().toString(); operation=action;
        spec.addProperty("action","start"); spec.addProperty("id",operationId); spec.addProperty("name","Keyboard: "+action);
        spec.addProperty("durationTicks",duration); spec.addProperty("sampleEveryTicks",20); spec.addProperty("retainInputs",true);
        spec.add("events",ProjectStore.JSON.toJsonTree(events)); spec.add("assertions",ProjectStore.JSON.toJsonTree(assertions));
        Object result=circuits.request(spec).join(); profile.addProperty("operationId",operationId); save(); return result;
    }
    private void event(List<CircuitTestService.Event> events,int tick,Object... args) {
        var set=new LinkedHashMap<String,Boolean>();
        var inputs=ProjectStore.JSON.fromJson(profile,CircuitTestService.Spec.class).inputs();
        for(int i=0;i<args.length;i+=2) { String id=args[i]+"[0]"; if(inputs.stream().anyMatch(p->p.id().equals(id))) set.put(id,(Boolean)args[i+1]); else throw new IllegalArgumentException("Missing keyboard input: "+id); }
        events.add(new CircuitTestService.Event(tick,set));
    }
    private static void assertBus(List<CircuitTestService.Assertion> list,int tick,String ref,int width,int value) {
        for(int i=0;i<width;i++) list.add(new CircuitTestService.Assertion(tick,ref+"["+i+"]",(value&(1<<i))==0?0:1,(value&(1<<i))==0?0:15));
    }
    void tick() {
        if(profile==null) return;
        JsonObject current=ProjectStore.JSON.toJsonTree(circuits.status()).getAsJsonObject();
        if(current.has("id") && current.get("id").getAsString().equals(operationId))lastCircuit=current;
        try {
            Map<String,Integer> live=live();
            if(!live.equals(previous)) {
                history.addLast(Map.of("tick",RedstoneEngine.time(player.get().level()),"values",live));
                while(history.size()>48) history.removeFirst(); previous=live;
            }
        } catch(Exception ignored) { history.clear(); previous=Map.of(); }
    }
    private Map<String,Integer> live() {
        requireBinding(); var values=new LinkedHashMap<String,Integer>(); var level=player.get().level();
        var spec=ProjectStore.JSON.fromJson(profile,CircuitTestService.Spec.class);
        if(spec.probes()==null || spec.probes().isEmpty() || spec.inputs()==null || spec.inputs().isEmpty())
            throw new IllegalStateException("计算机绑定不完整，请重新绑定实体电路");
        for(var input:spec.inputs()) {
            var p=input.position(); var pos=new BlockPos(p.x(),p.y(),p.z());
            if(!level.hasChunkAt(pos)) throw new IllegalStateException("计算机所在区块未加载，请靠近计算机后重试");
            var block=level.getBlockState(pos).getBlock();
            if(!(block instanceof LeverBlock) && !(block instanceof ButtonBlock))
                throw new IllegalStateException("计算机控制元件缺失，请检查实体电路或重新绑定");
        }
        for(var probe:spec.probes()) {
            var p=probe.position(); var pos=new BlockPos(p.x(),p.y(),p.z());
            if(!level.hasChunkAt(pos)) throw new IllegalStateException("计算机所在区块未加载，请靠近计算机后重试");
            var state=level.getBlockState(pos);
            if(!(state.getBlock() instanceof RedStoneWireBlock)) throw new IllegalStateException("计算机信号线路缺失，请检查实体电路或重新绑定");
            int signal=state.getValue(RedStoneWireBlock.POWER);
            String id=probe.id(),ref=id.substring(0,id.lastIndexOf('[')); int bit=Integer.parseInt(id.substring(id.lastIndexOf('[')+1,id.length()-1));
            values.merge(ref,signal>0?1<<bit:0,(a,b)->a|b);
        }
        return values;
    }
    Object status() {
        var result=new LinkedHashMap<String,Object>(); result.put("bound",profile!=null); result.put("available",false); result.put("operation",operation);
        result.put("reason","此世界未绑定红石计算机，建筑功能可正常使用");
        result.put("busy",circuits.ownsWriter()); result.put("circuit",lastCircuit==null?Map.of("status","idle"):lastCircuit);
        if(profile!=null) {
            result.put("program",profile.has("program")?profile.get("program").getAsString():"LDI 5\nADD 3\nOUT\nHLT");
            if(profile.has("draft"))result.put("draft",profile.get("draft").getAsString());
            result.put("requiresRestore",operationId!=null && lastCircuit==null && Files.exists(path.getParent().resolve("tests").resolve(operationId).resolve("before.json")));
            if(operationId!=null) result.put("operationId",operationId);
            try { result.put("live",live()); result.put("available",true); result.remove("reason"); result.put("history",List.copyOf(history)); }
            catch(Exception e) { result.put("reason",e.getMessage()); history.clear(); previous=Map.of(); }
        }
        return result;
    }
}
