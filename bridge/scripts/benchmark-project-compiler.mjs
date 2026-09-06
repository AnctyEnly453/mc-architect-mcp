// Offline benchmark only. No connection to Minecraft and no world mutation.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { performance } from "node:perf_hooks";
import { WorkspaceStore } from "../dist/workspace-store.js";
import { planWorkspace } from "../dist/workspace-plan.js";
import { randomUUID } from "node:crypto";

const output = resolve(process.argv[2] ?? "artifacts/compiler-benchmark");
await mkdir(output, { recursive: true });
const sourcePath = join(output, "source.json");
const source = { format: "mcengineer/workspace/1", name: "Offline 16M volume",
  projectId: "offline-16m-benchmark", worldId: "offline-not-a-minecraft-save", dimension: "minecraft:overworld",
  modules: [{ id: "volume", name: "Volume", operations: [{ from: { x: -512, y: 64, z: -512 }, to: { x: 511, y: 79, z: 511 }, block: "minecraft:stone_bricks" }] }],
};
await writeFile(sourcePath, JSON.stringify(source));
const began = performance.now();
const store = new WorkspaceStore(join(output, randomUUID())); await store.create(source);
const prepared = await planWorkspace(store);
const report = { kind: "offline compiler; not an in-game TPS benchmark", ...prepared,
  elapsedMs: Math.round(performance.now() - began), maxRssKiB: process.resourceUsage().maxRSS,
  node: process.version, platform: process.platform };
await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
