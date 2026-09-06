package dev.mcarchitect.mixin;

import it.unimi.dsi.fastutil.longs.Long2LongMap;
import it.unimi.dsi.fastutil.longs.Long2ObjectMap;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.ticks.LevelChunkTicks;
import net.minecraft.world.ticks.LevelTicks;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(LevelTicks.class)
public interface LevelTicksAccessor {
    @Accessor("allContainers") Long2ObjectMap<LevelChunkTicks<Block>> mcengineer$containers();
    @Accessor("nextTickForContainer") Long2LongMap mcengineer$nextTicks();
}
