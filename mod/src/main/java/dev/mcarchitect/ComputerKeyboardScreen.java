package dev.mcarchitect;

import com.google.gson.*;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;

/** Native, non-pausing terminal with live physical signal visualization. */
final class ComputerKeyboardScreen extends Screen {
    private final EditBox[] rows=new EditBox[8];
    private final String[] draft={"LDI 5","ADD 3","OUT","HLT","HLT","HLT","HLT","HLT"};
    private final List<Button> actions=new ArrayList<>();
    private EditBox input;
    private String inputDraft="0", message="正在连接计算机…";
    private JsonObject status=new JsonObject();
    private boolean demo, pending, polling, initialized, edited;
    private int left, top, panelWidth, poll;
    private ComputerKeyboardScreen(boolean demo,JsonObject initial) { super(Component.literal("红石计算机"));this.demo=demo;this.status=initial; }
    static CompletableFuture<Map<String,Object>> open(boolean demo,boolean notify) {
        var result=new CompletableFuture<Map<String,Object>>();var client=Minecraft.getInstance();
        client.execute(()->{
            var level=client.level;var screen=client.screen;
            JsonObject request=new JsonObject();request.addProperty("action","status");
            ArchitectHttpServer.keyboardFromClient(request).whenComplete((value,error)->client.execute(()->{
                if(level==null || client.level!=level || client.screen!=screen) {
                    result.complete(Map.of("opened",false,"reason","世界或界面已切换，请重试"));return;
                }
                if(error!=null || !available(value)) {
                    String reason=error!=null?"计算机面板仅支持已绑定实体电路的单人世界":reason(value);
                    if(notify && client.player!=null)client.player.displayClientMessage(Component.literal(reason),true);
                    result.complete(Map.of("opened",false,"reason",reason));return;
                }
                client.setScreen(new ComputerKeyboardScreen(demo,value));result.complete(Map.of("opened",true));
            }));
        });
        return result;
    }
    private static boolean available(JsonObject value) { return value!=null && value.has("available") && value.get("available").getAsBoolean(); }
    private static String reason(JsonObject value) { return value.has("reason")?value.get("reason").getAsString():"计算机暂不可用，请检查绑定和实体电路"; }
    @Override public boolean isPauseScreen() { return false; }
    private Button button(String text,int x,int y,int w,Runnable action,boolean mutation) {
        Button button=addRenderableWidget(Button.builder(Component.literal(text),b->action.run()).bounds(x,y,w,18).build());
        if(mutation) actions.add(button); return button;
    }
    @Override protected void init() {
        actions.clear(); left=Math.max(8,(width-520)/2); panelWidth=Math.min(520,width-16); top=Math.max(6,(height-232)/2);
        if(!available(status)) {
            button("关闭",left+4,top+161,90,this::onClose,false);
            if(status.has("requiresRestore") && status.get("requiresRestore").getAsBoolean() || status.has("busy") && status.get("busy").getAsBoolean())
                button("取消 / 恢复",left+100,top+161,120,()->send(status.has("requiresRestore")&&status.get("requiresRestore").getAsBoolean()?"restore":"cancel"),false);
            return;
        }
        button(demo?"← 程序键盘":"可视化演示 →",left+panelWidth-112,top+3,108,()->{ remember(); demo=!demo; rebuildWidgets(); },false);
        if(!demo) {
            int half=panelWidth/2;
            for(int i=0;i<8;i++) {
                int index=i,x=left+18+(i/4)*half,y=top+43+(i%4)*22;
                rows[i]=addRenderableWidget(new EditBox(font,x,y,half-27,18,Component.literal("指令 "+i)));
                rows[i].setMaxLength(48); rows[i].setValue(draft[i]); rows[i].setResponder(value->{draft[index]=value;edited=true;});
            }
            button("粘贴程序",left+4,top+137,76,()->paste(minecraft.keyboardHandler.getClipboard()),false);
            button("写入",left+84,top+137,62,()->send("write"),true);
            button("写入并运行",left+150,top+137,100,()->send("write-run"),true);
            button("示例 5 + 3",left+254,top+137,Math.max(70,panelWidth-258),()->paste("LDI 5\nADD 3\nOUT\nHLT"),false);
        } else {
            button("慢速观察",left+4,top+137,90,()->speed(32),true);
            button("快速运行",left+98,top+137,90,()->speed(128),true);
            button("复位",left+192,top+137,58,()->send("reset"),true);
            button("单步时钟",left+254,top+137,Math.max(70,panelWidth-258),()->send("step"),true);
        }
        button("运行",left+4,top+161,54,()->send("run"),true);
        button("停止",left+62,top+161,54,()->send("stop"),true);
        input=addRenderableWidget(new EditBox(font,left+121,top+161,55,18,Component.literal("输入数字")));
        input.setMaxLength(5);input.setValue(inputDraft);input.setResponder(value->inputDraft=value);
        button("输入数字",left+180,top+161,72,()->send("input"),true);
        button("取消 / 恢复",left+256,top+161,Math.max(68,panelWidth-260),()->send(status.has("requiresRestore")&&status.get("requiresRestore").getAsBoolean()?"restore":"cancel"),false);
        setInitialFocus(demo?input:rows[0]);
        refresh();
    }
    private void remember() { if(input!=null) inputDraft=input.getValue(); }
    private void paste(String text) {
        try {
            var words=KeyboardProgram.parse(text);
            for(int i=0;i<8;i++) { draft[i]=words.get(i).op()+" "+words.get(i).value(); if(rows[i]!=null&&!demo) rows[i].setValue(draft[i]); }
            edited=true; message="程序已填入，点击“写入”保存到计算机。";
        } catch(Exception e) { message=e.getMessage(); }
    }
    private void speed(int speed) { JsonObject r=new JsonObject();r.addProperty("action","speed");r.addProperty("speed",speed);request(r); }
    private void send(String action) {
        remember(); JsonObject r=new JsonObject();r.addProperty("action",action);
        r.addProperty("program",String.join("\n",draft));r.addProperty("input",inputDraft);request(r);
    }
    private void request(JsonObject r) {
        String action=r.get("action").getAsString();
        if(!available(status) && !action.equals("cancel") && !action.equals("restore")) {message=reason(status);return;}
        if(pending) return; pending=true;message="正在提交…";
        ArchitectHttpServer.keyboardFromClient(r).whenComplete((value,error)->minecraft.execute(()->{
            pending=false;
            if(error!=null) { Throwable cause=error; while(cause.getCause()!=null) cause=cause.getCause(); message=cause.getMessage(); }
            else { message="操作已提交";refresh(); }
        }));
    }
    private void refresh() {
        if(polling) return; polling=true;
        JsonObject r=new JsonObject();r.addProperty("action","status");
        ArchitectHttpServer.keyboardFromClient(r).whenComplete((incoming,error)->minecraft.execute(()->{
            polling=false;
            JsonObject value=incoming;
            if(error!=null) { value=new JsonObject();value.addProperty("available",false);value.addProperty("reason","计算机连接已断开，请返回原存档后重试"); }
            boolean wasAvailable=available(status);
            status=value;
            if(wasAvailable!=available(status)) {remember();rebuildWidgets();}
            if(!available(status)) {message=reason(status);return;}
            if(!initialized && value.has("program")) {
                if(!edited) {
                    if(value.has("draft")) {String[] lines=value.get("draft").getAsString().split("\n",-1);for(int i=0;i<8;i++){draft[i]=i<lines.length?lines[i]:"HLT";if(!demo)rows[i].setValue(draft[i]);}}
                    else paste(value.get("program").getAsString());
                }
                initialized=true;
            }
            if(value.has("error")) message=value.get("error").getAsString();
            else if(!value.has("bound") || !value.get("bound").getAsBoolean()) message="当前世界尚未绑定计算机";
            else if(value.has("circuit")) {
                var circuit=value.getAsJsonObject("circuit"); String state=circuit.get("status").getAsString();
                if(circuit.has("error")) message=circuit.get("error").getAsString();
                else if(circuit.has("failures") && !circuit.getAsJsonArray("failures").isEmpty()) message="校验失败，请查看计算机接线";
                else if(value.get("busy").getAsBoolean()) message="操作进行中  "+(circuit.has("elapsedTicks")?circuit.get("elapsedTicks").getAsInt():0)+" / "+(circuit.has("durationTicks")?circuit.get("durationTicks").getAsInt():0);
                else if(state.equals("complete")) message="操作完成";
            }
        }));
    }
    @Override public void tick() { if(++poll%5==0) refresh();boolean busy=pending||(status.has("busy")&&status.get("busy").getAsBoolean());for(Button b:actions)b.active=available(status)&&!busy; }
    private int value(String key) { return status.has("live")&&status.getAsJsonObject("live").has(key)?status.getAsJsonObject("live").get(key).getAsInt():0; }
    private void text(GuiGraphics g,String s,int x,int y,int color) { g.drawString(font,s,x,y,color,false); }
    private void box(GuiGraphics g,int x,int y,int w,String title,String number,boolean active) {
        g.fill(x,y,x+w,y+33,active?0xff164d57:0xff202d40);g.fill(x,y,x+2,y+33,active?0xff51e1c2:0xff506178);
        text(g,title,x+7,y+5,0xffa8bdd6);text(g,number,x+7,y+19,0xffedf7ff);
    }
    private void visualize(GuiGraphics g) {
        int x=left+4,y=top+42,w=(panelWidth-28)/3;
        int opcode=value("cpu.opcode"),pc=value("cpu.pc");String[] ops={"LDI","ADD","OUT","HLT","IN"};String op=opcode<5?ops[opcode]:"?";
        g.fill(x+w,y+16,x+2*w+16,y+18,0xff52647a);
        g.fill(x+w,y+56,x+2*w+16,y+58,0xff52647a);
        box(g,x,y,w,"PC · 指令地址",String.format("%d / 7",pc),true);
        box(g,x+w+8,y,w,"当前指令",op, value("cpu.halt")==0);
        box(g,x+2*w+16,y,w,"输入 IN",Integer.toString(value("terminal.entry")&255),opcode==4);
        box(g,x,y+40,w,"累加器 ACC",Integer.toString(value("io.qA")),opcode<2||opcode==4);
        box(g,x+w+8,y+40,w,"输出 OUT",Integer.toString(value("cpu.out")),opcode==2);
        box(g,x+2*w+16,y+40,w,"状态",value("cpu.halt")>0?"已停机":value("cpu.clock")>0?"时钟高电平":"时钟低电平",value("cpu.clock")>0);
        if(status.has("history")) {
            JsonArray history=status.getAsJsonArray("history");int len=history.size(),step=Math.max(2,(panelWidth-66)/48),start=x+58;
            text(g,"CLK",x,top+122,0xffa8bdd6);
            for(int i=0;i<len;i++) {var values=history.get(i).getAsJsonObject().getAsJsonObject("values");int high=values.has("cpu.clock")?values.get("cpu.clock").getAsInt():0;int xx=start+i*step;g.fill(xx,top+(high>0?120:127),xx+step,top+(high>0?122:129),0xff51e1c2);}
        }
    }
    @Override public void render(GuiGraphics g,int mouseX,int mouseY,float delta) {
        g.fill(0,0,width,height,0xcf08111e);g.fill(left,top,left+panelWidth,top+222,0xf0131f30);
        if(!available(status)) {
            text(g,"红石计算机暂不可用",left+6,top+8,0xfff1f7ff);
            text(g,font.plainSubstrByWidth(reason(status),panelWidth-16),left+8,top+64,0xffe4c68a);
            text(g,"建筑与其他工程功能不受影响。",left+8,top+92,0xffa8bdd6);
            super.render(g,mouseX,mouseY,delta);return;
        }
        text(g,demo?"红石计算机 · 实时演示":"红石计算机 · 程序键盘",left+6,top+8,0xfff1f7ff);
        text(g,demo?"读取真实电路信号 · 下方为最近信号变化":"LDI 数字  /  ADD 数字  /  OUT  /  IN  /  HLT",left+6,top+28,0xffa8bdd6);
        if(demo) visualize(g);
        else for(int i=0;i<8;i++) { int y=top+47+i%4*22,x=left+5+(i/4)*(panelWidth/2); text(g,Integer.toString(i),x,y,i==value("cpu.pc")?0xff51e1c2:0xff8498b4); }
        text(g,font.plainSubstrByWidth(message,panelWidth-12),left+6,top+188,0xffe4c68a);
        String live=String.format("PC %d   ACC %d   OUT %d   %s",value("cpu.pc"),value("io.qA"),value("cpu.out"),value("cpu.halt")>0?"HALT":"");
        text(g,live,left+6,top+205,0xff51e1c2);
        super.render(g,mouseX,mouseY,delta);
    }
    @Override public boolean keyPressed(KeyEvent event) {
        if(event.key()==GLFW.GLFW_KEY_F8) { onClose();return true; }
        if(!available(status)) return super.keyPressed(event);
        if(event.key()==GLFW.GLFW_KEY_F5) {send("run");return true;}
        if((event.modifiers()&GLFW.GLFW_MOD_CONTROL)!=0) {
            if(event.key()==GLFW.GLFW_KEY_ENTER) {send("write-run");return true;}
            if(event.key()==GLFW.GLFW_KEY_V) {String clip=minecraft.keyboardHandler.getClipboard();if(clip.contains("\n")||clip.contains(";")){paste(clip);return true;}}
        }
        return super.keyPressed(event);
    }
    @Override public void onClose() {
        JsonObject request=new JsonObject();request.addProperty("action","draft");request.addProperty("program",String.join("\n",draft));
        if(initialized && available(status))ArchitectHttpServer.keyboardFromClient(request);
        super.onClose();
    }
}
