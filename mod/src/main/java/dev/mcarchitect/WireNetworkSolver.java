package dev.mcarchitect;

import java.util.ArrayDeque;

/** Pure numerical work: no Minecraft world, block state or shared mutable arrays. */
public final class WireNetworkSolver {
    private WireNetworkSolver() {}

    public static int[] solve(int[][] outgoing, int[] sources) {
        if (outgoing.length != sources.length) throw new IllegalArgumentException("Network width mismatch");
        int[] power = sources.clone();
        @SuppressWarnings("unchecked") ArrayDeque<Integer>[] buckets = new ArrayDeque[16];
        for (int i = 0; i < 16; i++) buckets[i] = new ArrayDeque<>();
        for (int i = 0; i < power.length; i++) {
            if (power[i] < 0 || power[i] > 15) throw new IllegalArgumentException("Invalid signal strength");
            if (power[i] > 0) buckets[power[i]].add(i);
        }
        for (int strength = 15; strength > 1; strength--) {
            while (!buckets[strength].isEmpty()) {
                int node = buckets[strength].removeFirst();
                if (power[node] != strength) continue;
                for (int target : outgoing[node]) {
                    if (power[target] < strength - 1) {
                        power[target] = strength - 1;
                        buckets[strength - 1].add(target);
                    }
                }
            }
        }
        return power;
    }
}
