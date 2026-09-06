#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { WorkspaceStore } from "./workspace-store.js";
import { planWorkspace } from "./workspace-plan.js";
import { previewWorkspace } from "./workbench.js";
import { MinecraftClient } from "./client.js";
import { buildStatus, deployWorkspace, controlWorkspace } from "./workspace-build.js";
import { startSuite } from "./circuit-suite.js";
import { renderTrace } from "./waveform.js";
const [action, directory, file, revision] = process.argv.slice(2);
try {
  if (!directory) throw new Error("Usage: workspace <create|inspect|preview|plan|deploy|status|pause|resume|rollback|import|test|waveform> <directory> [JSON file] [expectedRevision]");
  const store = new WorkspaceStore(directory), source = async () => JSON.parse(await readFile(file, "utf8"));
  let result: unknown;
  switch (action) {
    case "create": result = await store.create(await source()); break;
    case "inspect": result = await store.summary(); break;
    case "preview": result = await previewWorkspace(store); break;
    case "plan": result = await planWorkspace(store); break;
    case "deploy": result = await deployWorkspace(store, await MinecraftClient.create()); break;
    case "status": result = await buildStatus(store, await MinecraftClient.create()); break;
    case "pause": case "resume": case "rollback": result = await controlWorkspace(store, await MinecraftClient.create(), action); break;
    case "import": result = await store.edit(Number(revision), { source: await source(), message: "Import revised source" }); break;
    case "test": result = await startSuite(store, await MinecraftClient.create(), await source()); break;
    case "waveform": result = await renderTrace(file, directory); break;
    default: throw new Error("Unknown workspace command");
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
