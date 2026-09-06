package dev.mcarchitect;

import java.util.*;

/** Autonomous signal and dust connection properties are relaxed; component configuration remains exact. */
final class StateRules {
    private static final Map<String, Set<String>> DYNAMIC = Map.of(
            "minecraft:redstone_wire", Set.of("power", "north", "east", "south", "west"),
            "minecraft:repeater", Set.of("powered", "locked"),
            "minecraft:comparator", Set.of("powered"),
            "minecraft:redstone_torch", Set.of("lit"),
            "minecraft:redstone_wall_torch", Set.of("lit"),
            "minecraft:redstone_lamp", Set.of("lit"));
    static boolean equivalent(String actual, String expected, String policy) {
        if (Objects.equals(actual, expected)) return true;
        if (actual == null || expected == null || !"redstone".equals(policy)) return false;
        return stable(actual).equals(stable(expected));
    }
    private static String stable(String state) {
        int bracket = state.indexOf('['); if (bracket < 0) return state;
        String block = state.substring(0, bracket);
        Set<String> ignored = DYNAMIC.get(block); if (ignored == null) return state;
        var properties = new TreeMap<String, String>();
        for (String item : state.substring(bracket + 1, state.length() - 1).split(",")) {
            String[] pair = item.split("=", 2);
            if (pair.length == 2 && !ignored.contains(pair[0])) properties.put(pair[0], pair[1]);
        }
        return block + properties;
    }
}
