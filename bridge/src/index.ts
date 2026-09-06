#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MinecraftClient } from "./client.js";
import { WorkspaceStore } from "./workspace-store.js";
import { point, operation } from "./workspace-model.js";
import { planWorkspace, readOptional } from "./workspace-plan.js";
import { previewWorkspace } from "./workbench.js";
import { deployWorkspace, buildStatus, controlWorkspace } from "./workspace-build.js";
import { startSuite } from "./circuit-suite.js";
import { renderTrace } from "./waveform.js";
const server = new McpServer({ name: "mcengineer", version: "0.9.1" });
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
async function respond(action: () => Promise<unknown>) {
  try { return { content: [{ type: "text" as const, text: JSON.stringify(await action()) }] }; }
  catch (e) { return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }] }; }
}
const required = <T>(value: T | undefined, name: string): T => { if (value === undefined) throw new Error(`${name} is required`); return value; };
server.registerTool("mc_keyboard", {
  description: "Optional terminal for an existing physical computer; it does not build or emulate one. Check status.available first: unbound, unloaded or missing hardware returns a reason without live readings, and open returns opened:false. With a valid world-bound profile, enter LDI/ADD/OUT/IN/HLT programs through physical buttons, run, reset, stop or step. Values are 0..255. Check status until operations finish.",
  inputSchema: { action:z.enum(["open","status","write","write-run","run","reset","stop","step","input","cancel","restore","speed"]),
    program:z.string().max(512).optional(), input:z.number().int().min(0).max(255).optional(), demo:z.boolean().optional(), speed:z.number().int().min(1).max(256).optional() }
},a=>respond(async()=>(await MinecraftClient.create()).keyboard(a)));
server.registerTool("mc_redstone", {
  description: "Configure opt-in redstone-only acceleration in the current dimension, inspect measured throughput, or disable and return pending ticks to vanilla. World and entity time stay normal. Finish tests and pause construction before changing mode. Parallel wire networks may differ on update-order-sensitive circuits; verify the actual machine.",
  inputSchema: { action: z.enum(["status", "configure", "disable"]), speed: z.number().int().min(1).max(256).optional(),
    workers: z.number().int().min(1).max(16).optional(), budgetMs: z.number().min(1).max(40).optional(), optimizeWires: z.boolean().optional() }
}, a => respond(async () => (await MinecraftClient.create()).redstone(a)));
server.registerTool("mc_world", { description: "Inspect game/world identity, create a flat creative world or open/save-close a local world. Get context before binding a workspace.",
  inputSchema: { action: z.enum(["health", "context", "ui", "list", "open", "create", "close", "save", "tick-rate"]), rate: z.number().min(1).max(200).optional(), levelId: z.string().optional() } },
  a => respond(async () => { const c = await MinecraftClient.create(); switch (a.action) {
    case "health": return c.health(); case "context": return c.context(); case "ui": return c.uiState(); case "list": return c.listWorlds();
    case "save": return c.saveWorld();
    case "open": return c.openWorld(required(a.levelId, "levelId")); case "create": return c.createWorld(required(a.levelId, "levelId")); case "close": return c.disconnect(); case "tick-rate": return c.setTickRate(required(a.rate, "rate"));
  } }));
server.registerTool("mc_inspect", { description: "Read bounded terrain/states/collision/lighting, validate walkable access or compare a small reference. Scans require loaded chunks; deployment loads work chunks automatically.",
  inputSchema: { action: z.enum(["scan", "access", "compare"]), from: point.optional(), to: point.optional(),
    mode: z.enum(["heightmap", "summary", "collision", "lighting", "full"]).default("summary"), start: point.optional(), goals: z.array(point).optional(),
    operations: z.array(operation).max(256).optional(), ignoreState: z.boolean().default(false) } }, a => respond(async () => {
    const c = await MinecraftClient.create();
    if (a.action === "compare") return c.compareBlueprint(required(a.operations, "operations"), a.ignoreState);
    const from = required(a.from, "from"), to = required(a.to, "to");
    return a.action === "access" ? c.validateAccess(from, to, required(a.start, "start"), required(a.goals, "goals")) : c.scan(from, to, a.mode);
  }));
server.registerTool("mc_camera", { description: "Begin a reversible spectator camera, move, capture an image artifact, or restore. Game screenshots are evidence separate from the offline geometric preview.",
  inputSchema: { action: z.enum(["begin", "move", "capture", "restore"]), position: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
    yaw: z.number().optional(), pitch: z.number().optional(), fov: z.number().optional() } },
  a => respond(async () => { const c = await MinecraftClient.create(); switch (a.action) {
    case "begin": return c.beginCamera(); case "move": return c.moveCamera(a.position, a.yaw, a.pitch, a.fov);
    case "capture": return c.screenshot(); case "restore": return c.restoreCamera();
  } }));
server.registerTool("mc_workspace", { description: "Create a persistent engineering workspace from local source JSON; inspect modules/ports/history; read a module; generate an interactive geometry preview. Architecture, machines and redstone use the same model.",
  inputSchema: { directory: z.string(), action: z.enum(["create", "inspect", "module", "preview"]), sourcePath: z.string().optional(), moduleId: z.string().optional() } },
  a => respond(async () => { const s = new WorkspaceStore(a.directory); switch (a.action) {
    case "create": return s.create(await json(required(a.sourcePath, "sourcePath"))); case "inspect": return s.summary(); case "preview": return previewWorkspace(s);
    case "module": { const h = await s.read(), m = h.source.modules.find(m => m.id === a.moduleId); if (!m) throw new Error("Unknown module"); return { revision: h.revision, module: m, template: m.template ? h.source.templates[m.template] : undefined }; }
  } }));
server.registerTool("mc_edit", { description: "Create an immutable revision by replacing/adding a named module, removing it, importing revised source, or restoring a revision. expectedRevision prevents stale edits. No world writes. Module removal plans air in formerly owned cells; deployment rollback restores before-images.",
  inputSchema: { directory: z.string(), expectedRevision: z.number().int().min(1), action: z.enum(["module", "remove", "source", "restore"]),
    moduleId: z.string().optional(), sourcePath: z.string().optional(), revisionId: z.string().optional(), message: z.string().optional() } }, a => respond(async () => {
    const input = a.action === "module" ? { moduleId: required(a.moduleId, "moduleId"), module: await json(required(a.sourcePath, "sourcePath")) }
      : a.action === "remove" ? { moduleId: required(a.moduleId, "moduleId"), remove: true }
      : a.action === "source" ? { source: await json(required(a.sourcePath, "sourcePath")) } : { restoreRevision: required(a.revisionId, "revisionId") };
    return new WorkspaceStore(a.directory).edit(a.expectedRevision, { ...input, message: a.message });
  }));
const jobs = new Map<string, { action: string; status: string; result?: unknown; error?: string; progress?: unknown }>();
const uploads = new Map<string, AbortController>();
server.registerTool("mc_build", { description: "Plan incremental deployment against the last completed revision; deploy stages; poll, pause/resume or roll back. Plan/deploy run in background: poll status. Mod advances stages without bridge. Retry deploy after interrupted upload; resume a started assembly. Guards detect external edits.",
  inputSchema: { directory: z.string(), action: z.enum(["plan", "deploy", "status", "pause", "resume", "rollback"]) } }, a => respond(async () => {
    const s = new WorkspaceStore(a.directory), prior = jobs.get(s.directory);
    if (prior?.status === "running") {
      if (a.action === "pause" && uploads.has(s.directory)) { uploads.get(s.directory)!.abort(new Error("Upload paused; retry deploy to continue")); return { ...prior, pauseRequested: true }; }
      return prior;
    }
    if (a.action === "plan" || a.action === "deploy") {
      const job: NonNullable<typeof prior> = { action: a.action, status: "running" }; jobs.set(s.directory, job);
      const controller = new AbortController(); if (a.action === "deploy") uploads.set(s.directory, controller);
      void (async () => a.action === "plan" ? planWorkspace(s) : deployWorkspace(s, await MinecraftClient.create(), {
        signal: controller.signal, progress: value => { job.progress = value; },
      }))().then(value => { job.result = value; job.status = "complete"; })
        .catch(e => { job.error = String(e); job.status = "failed"; }).finally(() => uploads.delete(s.directory)); return job;
    }
    if (a.action === "status") {
      const local = await readOptional<{ status: string }>(join(s.directory, "deployment.json"));
      if (!local) return prior ?? { status: "unplanned" };
      return { job: prior, ...await buildStatus(s, ["planned", "uploading", "upload_failed"].includes(local.status) ? undefined : await MinecraftClient.create()) };
    }
    return controlWorkspace(s, await MinecraftClient.create(), a.action);
  }));
server.registerTool("mc_test", { description: "Run real-game port-based redstone tests: drive existing levers or click vanilla buttons at game ticks, sample signals 0..15, check bit/bus assertions, restore inputs and persist traces. Buttons release after their vanilla pulse duration. Bit 0 is least significant. Limit: 384 test-region chunks, 64 input/probe bits. Restore recovers interrupted inputs; waveform renders saved trace data.",
  inputSchema: { directory: z.string(), action: z.enum(["start", "status", "cancel", "restore", "waveform"]), sourcePath: z.string().optional(), id: z.string().uuid().optional() } }, a => respond(async () => {
    const s = new WorkspaceStore(a.directory);
    if (a.action === "waveform") return renderTrace(required(a.sourcePath, "sourcePath"), s.directory);
    const c = await MinecraftClient.create();
    if (a.action === "start") return startSuite(s, c, await json(required(a.sourcePath, "sourcePath")));
    const id = a.id ?? (await readOptional<{ id: string }>(join(s.directory, "LAST_TEST.json")))?.id;
    return c.circuit({ action: a.action, id: required(id, "id") });
  }));
await server.connect(new StdioServerTransport());
