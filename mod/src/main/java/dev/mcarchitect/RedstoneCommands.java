package dev.mcarchitect;

import com.mojang.brigadier.arguments.IntegerArgumentType;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.permissions.Permissions;

final class RedstoneCommands {
    static void register(ArchitectHttpServer bridge) {
        CommandRegistrationCallback.EVENT.register((dispatcher, registry, environment) -> dispatcher.register(
            Commands.literal("mcengineer")
                .requires(source -> source.permissions().hasPermission(Permissions.COMMANDS_GAMEMASTER))
                .then(Commands.literal("redstone")
                    .executes(context -> execute(bridge, context.getSource(), "status", 1, 1))
                    .then(Commands.literal("off").executes(context -> execute(bridge, context.getSource(), "disable", 1, 1)))
                    .then(Commands.literal("status").executes(context -> execute(bridge, context.getSource(), "status", 1, 1)))
                    .then(Commands.argument("speed", IntegerArgumentType.integer(1, 256))
                        .executes(context -> execute(bridge, context.getSource(), "configure", IntegerArgumentType.getInteger(context, "speed"),
                            Math.min(8, Math.max(1, Runtime.getRuntime().availableProcessors()-2))))
                        .then(Commands.argument("workers", IntegerArgumentType.integer(1, 16))
                            .executes(context -> execute(bridge, context.getSource(), "configure", IntegerArgumentType.getInteger(context, "speed"),
                                IntegerArgumentType.getInteger(context, "workers"))))))));
    }
    private static int execute(ArchitectHttpServer bridge, CommandSourceStack source, String action, int speed, int workers) {
        try {
            var status = bridge.controlRedstone(source.getLevel(), action, speed, workers, 20, true);
            String message = Boolean.TRUE.equals(status.get("enabled"))
                ? String.format(java.util.Locale.ROOT, "红石加速 %s×，%s 个工作线程；实测 %.0f 红石步/秒，世界 %.0f tick/秒。/mcengineer redstone off 关闭。",
                    status.get("speed"), status.get("workers"), ((Number)status.get("redstoneTicksPerSecond")).doubleValue(), ((Number)status.get("worldTickRate")).doubleValue())
                : "红石加速已关闭；待执行红石事件已交还原版。";
            source.sendSuccess(() -> Component.literal(message), false); return 1;
        } catch (RuntimeException error) {
            source.sendFailure(Component.literal(error.getMessage())); return 0;
        }
    }
}
