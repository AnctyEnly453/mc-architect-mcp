import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { indexSections, prepareProject, sha256 } from "./project-plan.js";
import { resolveWorkspace, type ResolvedOperation } from "./workspace-model.js";
import { WorkspaceStore, atomicJSON, type Revision } from "./workspace-store.js";
import type { FillOperation } from "./client.js";

export type BuildPlan = { id: string; revisionId: string; baselineId?: string; status: string;
  worldId: string; dimension: string; stages: Array<{ name: string; directory: string; planId: string }>;
  diff: { added: number; changed: number; removed: number; unchanged: number; byModule: Record<string, number> }; directory: string };
export async function readOptional<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
}
function sectionCells(key: string, operations: ResolvedOperation[]) {
  const [sx, sy, sz] = key.split(",").map(Number), cells = new Array<ResolvedOperation | undefined>(4096);
  for (const op of operations) {
    for (let y = Math.max(op.from.y, sy * 16); y <= Math.min(op.to.y, sy * 16 + 15); y++)
      for (let z = Math.max(op.from.z, sz * 16); z <= Math.min(op.to.z, sz * 16 + 15); z++) {
        const base = (y - sy * 16) * 256 + (z - sz * 16) * 16;
        cells.fill(op, base + Math.max(op.from.x, sx * 16) - sx * 16, base + Math.min(op.to.x, sx * 16 + 15) - sx * 16 + 1);
      }
  }
  return cells;
}
export function workspaceDelta(current: Revision, baseline?: Revision) {
  const model = resolveWorkspace(current.source), prior = baseline ? resolveWorkspace(baseline.source) : undefined;
  const nextIndex = indexSections(model.operations), oldIndex = indexSections(prior?.operations ?? []);
  const stages = new Map<string, { operations: FillOperation[]; expectedOperations: FillOperation[] }>();
  const diff = { added: 0, changed: 0, removed: 0, unchanged: 0, byModule: {} as Record<string, number> };
  for (const key of new Set([...nextIndex.keys(), ...oldIndex.keys()])) {
    const pieces = new Map<string, Array<FillOperation & { expected?: string }>>();
    const next = sectionCells(key, nextIndex.get(key) as ResolvedOperation[] ?? []), old = sectionCells(key, oldIndex.get(key) as ResolvedOperation[] ?? []);
    const [sx, sy, sz] = key.split(",").map(Number);
    let cursor = 0;
    while (cursor < 4096) {
      const a = old[cursor], b = next[cursor];
      if (a?.block === b?.block) { if (a) diff.unchanged++; cursor++; continue; }
      const stage = b?.stage ?? "__remove", block = b?.block ?? "minecraft:air", expected = a?.block;
      const start = cursor, rowEnd = Math.floor(cursor / 16) * 16 + 16;
      while (cursor < rowEnd && old[cursor]?.block !== next[cursor]?.block
          && (next[cursor]?.stage ?? "__remove") === stage && (next[cursor]?.block ?? "minecraft:air") === block
          && old[cursor]?.block === expected) {
        const before = old[cursor], after = next[cursor];
        if (!before) diff.added++; else if (!after) diff.removed++; else diff.changed++;
        const owner = after?.moduleId ?? before!.moduleId;
        diff.byModule[owner] = (diff.byModule[owner] ?? 0) + 1; cursor++;
      }
      const from = { x: sx * 16 + start % 16, y: sy * 16 + Math.floor(start / 256), z: sz * 16 + Math.floor(start / 16) % 16 };
      const to = { ...from, x: from.x + cursor - start - 1 };
      let target = pieces.get(stage); if (!target) pieces.set(stage, target = []);
      target.push({ from, to, block, expected });
    }
    for (const [stage, rows] of pieces) {
      let target = stages.get(stage); if (!target) stages.set(stage, target = { operations: [], expectedOperations: [] });
      // Merge equal X-runs along Z, then equal slabs along Y, preserving guards.
      // A solid 16M-cell region becomes 4096 section cuboids, not 1M row objects.
      let compact = rows;
      for (const axis of ["z", "y"] as const) {
        const others = (["x", "y", "z"] as const).filter(a => a !== axis), groups = new Map<string, typeof rows>();
        for (const row of compact) {
          const k = JSON.stringify([row.block, row.expected, ...others.flatMap(a => [row.from[a], row.to[a]])]);
          let group = groups.get(k); if (!group) groups.set(k, group = []); group.push(row);
        }
        compact = [];
        for (const group of groups.values()) {
          group.sort((a,b) => a.from[axis] - b.from[axis]); let previous: typeof rows[number] | undefined;
          for (const row of group) {
            if (previous && previous.to[axis] + 1 === row.from[axis]) previous.to[axis] = row.to[axis];
            else { previous = { ...row, from: { ...row.from }, to: { ...row.to } }; compact.push(previous); }
          }
        }
      }
      for (const { expected, ...op } of compact) {
        target.operations.push(op); if (expected) target.expectedOperations.push({ ...op, block: expected });
      }
    }
    nextIndex.delete(key); oldIndex.delete(key);
  }
  return { diff, stages, order: ["__remove", ...model.stages], model };
}
export async function planWorkspace(store: WorkspaceStore): Promise<BuildPlan> {
  return store.lock(async () => {
    const head = await store.read();
    const inFlight = await readOptional<BuildPlan>(join(store.directory, "deployment.json"));
    if (inFlight && !["planned", "complete", "rolled_back"].includes(inFlight.status)) throw new Error("Finish or roll back the current deployment before planning another");
    const deployed = await readOptional<{ revisionId: string }>(join(store.directory, "DEPLOYED.json"));
    const baseline = deployed ? await store.revision(deployed.revisionId) : undefined;
    const delta = workspaceDelta(head, baseline);
    const attempt = randomUUID();
    const directory = join(store.directory, "builds", `${head.revision}-${attempt}`); await mkdir(directory, { recursive: true });
    const stages: BuildPlan["stages"] = [];
    for (const name of delta.order) {
      const part = delta.stages.get(name); if (!part?.operations.length) continue;
      const sourcePath = join(directory, `${name}.source.json`);
      await atomicJSON(sourcePath, { projectId: `${head.source.projectId.slice(0,80)}.${head.id.slice(0, 8)}.${attempt.slice(0,8)}.${stages.length}`,
        worldId: head.source.worldId, dimension: head.source.dimension, statePolicy: head.source.statePolicy, ...part });
      const prepared = await prepareProject(sourcePath, join(directory, "plans"));
      stages.push({ name, directory: prepared.directory, planId: prepared.planId });
    }
    const plan: BuildPlan = { id: sha256(stages.map(s => s.planId).join("\n")), revisionId: head.id, baselineId: baseline?.id,
      status: "planned", worldId: head.source.worldId, dimension: head.source.dimension, stages, diff: delta.diff, directory };
    await atomicJSON(join(directory, "build.json"), plan);
    await atomicJSON(join(store.directory, "deployment.json"), plan); return plan;
  });
}
