package dev.mcarchitect;

import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Records the game's own render target, with real capture timestamps. */
final class MinecraftVideoRecorder {
    private final Minecraft minecraft;
    private Session active, latest;
    private double[] cameraFrom,cameraTo;
    private long cameraStart;
    private double cameraSeconds;
    private net.minecraft.client.CloudStatus previousClouds;
    private Integer previousRenderDistance;
    private Boolean previousFog;
    private net.minecraft.client.InactivityFpsLimit previousInactivity;
    private Integer previousFps;
    MinecraftVideoRecorder(Minecraft minecraft) { this.minecraft=minecraft; }
    Map<String,Object> control(JsonObject request) {
        String action=request.get("action").getAsString();
        if(action.equals("start")) {
            if(active!=null || latest!=null && !latest.finished) throw new ArchitectClientController.ClientControlException(409,"Recording is active or draining");
            int fps=request.has("fps")?request.get("fps").getAsInt():24;
            if(fps<1 || fps>60) throw new ArchitectClientController.ClientControlException(400,"fps must be 1..60");
            int width=request.has("width")?request.get("width").getAsInt():1280;
            int height=request.has("height")?request.get("height").getAsInt():720;
            if(width<640 || width>3840 || height<360 || height>2160) throw new ArchitectClientController.ClientControlException(400,"Invalid video dimensions");
            String name=request.has("name")?request.get("name").getAsString():"clip";
            if(!name.matches("[A-Za-z0-9_-]{1,60}")) throw new ArchitectClientController.ClientControlException(400,"Invalid clip name");
            try {
                Path directory=minecraft.gameDirectory.toPath().resolve("recordings").resolve(System.currentTimeMillis()+"-"+name).toAbsolutePath();
                Files.createDirectories(directory);
                Session session=new Session(directory,fps,request.has("includeUI") && request.get("includeUI").getAsBoolean(),minecraft.getWindow().getScreenWidth(),minecraft.getWindow().getScreenHeight(),minecraft.getWindow().isFullscreen(),width,height);
                if(request.has("closeScreen") && request.get("closeScreen").getAsBoolean()) minecraft.setScreen(null);
                minecraft.getWindow().setWindowed(width,height);
                active=latest=session;
            } catch(Exception error) { throw new ArchitectClientController.ClientControlException(500,"Cannot start recording",error); }
        } else if(action.equals("presentation")) {
            if(previousClouds==null) previousClouds=minecraft.options.cloudStatus().get();
            minecraft.options.cloudStatus().set(net.minecraft.client.CloudStatus.OFF);
            if(previousRenderDistance==null) previousRenderDistance=minecraft.options.renderDistance().get();
            int distance=request.has("renderDistance")?request.get("renderDistance").getAsInt():24;
            minecraft.options.renderDistance().set(Math.max(8,Math.min(32,distance)));
            if(previousInactivity==null)previousInactivity=minecraft.options.inactivityFpsLimit().get();
            if(previousFps==null)previousFps=minecraft.options.framerateLimit().get();
            minecraft.options.inactivityFpsLimit().set(net.minecraft.client.InactivityFpsLimit.MINIMIZED);
            minecraft.options.framerateLimit().set(120);
            if(previousFog==null) previousFog=dev.mcarchitect.mixin.FogRendererAccessor.mcarchitect$isFogEnabled();
            boolean fog=request.has("fog") && request.get("fog").getAsBoolean();
            if(dev.mcarchitect.mixin.FogRendererAccessor.mcarchitect$isFogEnabled()!=fog) net.minecraft.client.renderer.fog.FogRenderer.toggleFog();
            minecraft.setScreen(null);
        } else if(action.equals("restore-presentation")) {
            if(previousClouds!=null) { minecraft.options.cloudStatus().set(previousClouds);previousClouds=null; }
            if(previousRenderDistance!=null) { minecraft.options.renderDistance().set(previousRenderDistance);previousRenderDistance=null; }
            if(previousFog!=null) { if(dev.mcarchitect.mixin.FogRendererAccessor.mcarchitect$isFogEnabled()!=previousFog) net.minecraft.client.renderer.fog.FogRenderer.toggleFog();previousFog=null; }
            if(previousInactivity!=null){minecraft.options.inactivityFpsLimit().set(previousInactivity);previousInactivity=null;}
            if(previousFps!=null){minecraft.options.framerateLimit().set(previousFps);previousFps=null;}
            cameraFrom=null;cameraTo=null;
        } else if(action.equals("camera")) {
            var from=request.getAsJsonArray("from"); var to=request.getAsJsonArray("to");
            if(from==null || to==null || from.size()!=5 || to.size()!=5) throw new ArchitectClientController.ClientControlException(400,"Camera endpoints require x,y,z,yaw,pitch");
            double[] a=new double[5],b=new double[5];
            for(int i=0;i<5;i++) { a[i]=from.get(i).getAsDouble(); b[i]=to.get(i).getAsDouble(); if(!Double.isFinite(a[i]) || !Double.isFinite(b[i])) throw new ArchitectClientController.ClientControlException(400,"Camera values must be finite"); }
            cameraSeconds=request.has("seconds")?request.get("seconds").getAsDouble():10;
            if(!Double.isFinite(cameraSeconds) || cameraSeconds<=0 || cameraSeconds>600) throw new ArchitectClientController.ClientControlException(400,"Camera duration must be 0..600 seconds");
            cameraFrom=a;cameraTo=b;cameraStart=System.nanoTime();
        } else if(action.equals("restore-camera")) { cameraFrom=null;cameraTo=null;
        } else if(action.equals("stop")) {
            Session session=active;
            if(session!=null) {
                active=null;
                session.duration=(System.nanoTime()-session.start)/1e9;
                minecraft.getWindow().setWindowed(session.oldWidth,session.oldHeight);
                if(session.fullscreen && !minecraft.getWindow().isFullscreen()) minecraft.getWindow().toggleFullScreen();
                session.writer.execute(() -> {
                    try {
                        session.stream.close();
                        if(!session.encoder.waitFor(25,TimeUnit.SECONDS)) {session.encoder.destroyForcibly();throw new IllegalStateException("Video encoder did not finish");}
                        if(session.encoder.exitValue()!=0)throw new IllegalStateException("Video encoder failed; see encoder.log");
                        Files.writeString(session.directory.resolve("frames.csv"),"file,seconds\n"+String.join("\n",session.frames)+"\n",StandardCharsets.UTF_8);
                    }
                    catch(Exception error) { session.error=error.toString(); }
                    session.finished=true;
                });
                session.writer.shutdown();
            }
        } else if(action.equals("close-screen")) minecraft.setScreen(null);
        else if(!action.equals("status")) throw new ArchitectClientController.ClientControlException(400,"Unknown video action");
        return status();
    }
    double[] cameraPose() {
        if(cameraFrom==null || minecraft.level==null) return null;
        double t=Math.min(1,(System.nanoTime()-cameraStart)/1e9/cameraSeconds);
        t=t*t*(3-2*t);
        double[] pose=new double[5];
        for(int i=0;i<5;i++) pose[i]=cameraFrom[i]+(cameraTo[i]-cameraFrom[i])*t;
        return pose;
    }
    private Map<String,Object> status() {
        Session session=latest;
        if(session==null) return Map.of("recording",false,"frames",0);
        return Map.of("recording",active!=null,"finished",session.finished,"path",session.directory.toString(),"frames",session.saved,"dropped",session.dropped,"fps",session.fps,"durationSeconds",active==null?session.duration:(System.nanoTime()-session.start)/1e9,"error",session.error);
    }
    void capture(boolean ui) {
        Session session=active;
        if(session==null || session.ui!=ui) return;
        long now=System.nanoTime();
        if(now<session.next) return;
        session.next=now+1_000_000_000L/session.fps;
        if(session.pending.get()>=3) { session.dropped++; return; }
        session.pending.incrementAndGet();
        String filename=Integer.toString(session.sequence++);
        double seconds=(now-session.start)/1e9;
        Screenshot.takeScreenshot(minecraft.getMainRenderTarget(), nativeImage -> {
            try {
                session.writer.execute(() -> {
                    try(nativeImage) {
                        if(nativeImage.getWidth()!=session.width || nativeImage.getHeight()!=session.height) {session.dropped++;return;}
                        int[] pixels=nativeImage.getPixelsABGR();
                        byte[] bytes=new byte[pixels.length*4];
                        for(int i=0;i<pixels.length;i++) {int pixel=pixels[i],j=i*4;bytes[j]=(byte)pixel;bytes[j+1]=(byte)(pixel>>>8);bytes[j+2]=(byte)(pixel>>>16);bytes[j+3]=(byte)(pixel>>>24);}
                        session.stream.write(bytes);
                        session.frames.add(filename+","+seconds);
                        session.saved++;
                    } catch(Exception error) { session.error=error.toString(); }
                    finally { session.pending.decrementAndGet(); }
                });
            } catch(RejectedExecutionException error) { nativeImage.close(); session.pending.decrementAndGet(); }
        });
    }
    private static final class Session {
        final Path directory; final int fps,oldWidth,oldHeight,width,height; final boolean ui,fullscreen;
        final Process encoder;final java.io.OutputStream stream;
        final long start=System.nanoTime(); long next; int sequence;
        final AtomicInteger pending=new AtomicInteger();
        final ExecutorService writer=Executors.newSingleThreadExecutor(r -> { Thread thread=new Thread(r,"MC video writer"); thread.setDaemon(true); return thread; });
        final List<String> frames=new ArrayList<>();
        volatile int saved,dropped; volatile boolean finished; volatile String error=""; double duration;
        Session(Path directory,int fps,boolean ui,int oldWidth,int oldHeight,boolean fullscreen,int width,int height) throws java.io.IOException {
            this.directory=directory;this.fps=fps;this.ui=ui;this.oldWidth=oldWidth;this.oldHeight=oldHeight;this.fullscreen=fullscreen;this.width=width;this.height=height;
            encoder=new ProcessBuilder("ffmpeg","-hide_banner","-loglevel","error","-y","-f","rawvideo","-pixel_format","rgba","-video_size",width+"x"+height,"-framerate",Integer.toString(fps),"-i","pipe:0","-an","-c:v","libx264","-preset","veryfast","-threads","4","-crf","18","-pix_fmt","yuv420p","-movflags","+faststart",directory.resolve("capture.mp4").toString()).redirectError(directory.resolve("encoder.log").toFile()).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            stream=new java.io.BufferedOutputStream(encoder.getOutputStream(),1<<20);
        }
    }
}
