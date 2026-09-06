import { join } from "node:path";
import { unlink } from "node:fs/promises";
import { MinecraftClient } from "./client.js";
import { uploadProject } from "./project-transfer.js";
import { WorkspaceStore, atomicJSON } from "./workspace-store.js";
import { readOptional, type BuildPlan } from "./workspace-plan.js";

type Engine = Pick<MinecraftClient, "assembly" | "project" | "health">;
async function load(store: WorkspaceStore) {
  const plan = await readOptional<BuildPlan>(join(store.directory, "deployment.json"));
  if (!plan) throw new Error("Plan the workspace first"); return plan;
}
async function save(store: WorkspaceStore, plan: BuildPlan) {
  await atomicJSON(join(plan.directory, "build.json"), plan);
  await atomicJSON(join(store.directory, "deployment.json"), plan);
}
async function adopt(store: WorkspaceStore, plan: BuildPlan) {
  const revisionId = plan.status === "complete" ? plan.revisionId : plan.baselineId;
  if (revisionId) await atomicJSON(join(store.directory, "DEPLOYED.json"), { revisionId });
  else await unlink(join(store.directory, "DEPLOYED.json")).catch(e => { if (e.code !== "ENOENT") throw e; });
}
export async function buildStatus(store: WorkspaceStore, client?: Engine) {
  return store.lock(async () => {
    const plan = await load(store);
    if (["planned", "uploading", "upload_failed"].includes(plan.status) || !client || !plan.stages.length) return { plan };
    const remote = await client.assembly({ action: "status", id: plan.id }) as any;
    const status = remote.status ?? remote.checkpoint?.status;
    if (!remote.requiresExplicitResume && ["complete", "rolled_back"].includes(status)) {
      plan.status = status; await adopt(store, plan); await save(store, plan);
    }
    return { plan, engine: remote };
  });
}
export async function deployWorkspace(store: WorkspaceStore, client: Engine, options: {
  signal?: AbortSignal; progress?: (value: { stage: string; stageIndex: number; stageCount: number; uploaded: number; total: number }) => void;
} = {}) {
  return store.lock(async () => {
    const plan = await load(store);
    // A no-op deployment has no native assembly to query, including on retries.
    if (!plan.stages.length && plan.status === "complete") return { plan };
    if (!["planned", "uploading", "upload_failed"].includes(plan.status)) {
      return { plan, engine: await client.assembly({ action: "status", id: plan.id }) };
    }
    if ((await store.read()).id !== plan.revisionId) throw new Error("Workspace changed after preview; prepare a new plan");
    if (!plan.stages.length) { plan.status = "complete"; await adopt(store, plan); await save(store, plan); return { plan }; }
    const health = await client.health() as { capabilities?: string[] };
    for (const capability of ["project-stream-v1", "project-guards-v1", "assembly-v1"]) {
      if (!health.capabilities?.includes(capability)) throw new Error(`Mod lacks ${capability}; install 0.7.0`);
    }
    plan.status = "uploading"; await save(store, plan);
    try {
      for (const [index, stage] of plan.stages.entries()) {
        options.signal?.throwIfAborted();
        await uploadProject(stage.directory, client, (uploaded, total) => {
          options.progress?.({ stage: stage.name, stageIndex: index, stageCount: plan.stages.length, uploaded, total });
          options.signal?.throwIfAborted();
        });
      }
    }
    catch (e) { plan.status = "upload_failed"; await save(store, plan); throw e; }
    // Persist uncertainty before a network call that can start world writes.
    plan.status = "starting"; await save(store, plan);
    if (options.signal?.aborted) { plan.status = "upload_failed"; await save(store, plan); options.signal.throwIfAborted(); }
    const engine = await client.assembly({ action: "start", id: plan.id, worldId: plan.worldId, dimension: plan.dimension,
      steps: plan.stages.map(s => ({ name: s.name, planId: s.planId })) });
    plan.status = "running"; await save(store, plan); return { plan, engine };
  });
}
export async function controlWorkspace(store: WorkspaceStore, client: Engine, action: "pause" | "resume" | "rollback") {
  return store.lock(async () => {
    const plan = await load(store);
    if (!plan.stages.length || ["planned", "uploading", "upload_failed"].includes(plan.status)) throw new Error("Deployment has not started");
    // Even a completed build must be marked in flight before rollback/resume.
    if (action !== "pause") { plan.status = action === "rollback" ? "rolling_back" : "running"; await save(store, plan); }
    const engine = await client.assembly(action === "resume" ? { action: "start", id: plan.id, worldId: plan.worldId, dimension: plan.dimension,
      steps: plan.stages.map(s => ({ name: s.name, planId: s.planId })) } : { action, id: plan.id }); return { plan, engine };
  });
}
