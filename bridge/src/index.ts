#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { FillOperation, MinecraftClient, Position } from "./client.js";
import { circleOperations, curvedWallOperations, domeOperations, spiralStairOperations } from "./geometry.js";
import { boxOperations } from "./boxes.js";

const server = new McpServer({ name: "mcarchitect", version: "0.5.0" });

const position = z.object({
  x: z.number().int().describe("Minecraft X coordinate"),
  y: z.number().int().describe("Minecraft Y coordinate"),
  z: z.number().int().describe("Minecraft Z coordinate"),
});

const cameraPosition = z.object({ x: z.number(), y: z.number(), z: z.number() });

const blockState = z.string()
  .regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+(?:\[[a-z0-9_=,.-]+\])?$/)
  .describe("Namespaced block ID with optional state properties");

const cuboid = z.object({ from: position, to: position, block: blockState });
const projectId = z.string().min(1).max(120).optional();

server.registerTool(
  "mc_health",
  { description: "Check whether the MC Architect mod and a single-player world are available." },
  async () => result(await withClient((client) => client.health())),
);

server.registerTool(
  "mc_ui_state",
  { description: "Get the current Minecraft screen and whether a local world is open." },
  async () => result(await withClient((client) => client.uiState())),
);

server.registerTool(
  "mc_list_worlds",
  { description: "List compatible Minecraft single-player saves from the title screen." },
  async () => result(await withClient((client) => client.listWorlds())),
);

server.registerTool(
  "mc_open_world",
  {
    description: "Open a single-player save by level ID. Poll mc_ui_state until worldOpen is true.",
    inputSchema: { levelId: z.string().min(1) },
  },
  async ({ levelId }) => result(await withClient((client) => client.openWorld(levelId))),
);

server.registerTool(
  "mc_disconnect",
  { description: "Save the current single-player world and return to the title screen." },
  async () => result(await withClient((client) => client.disconnect())),
);

server.registerTool(
  "mc_get_context",
  { description: "Get the local player's position, rotation, dimension, and game mode." },
  async () => result(await withClient((client) => client.context())),
);

server.registerTool(
  "mc_scan_region",
  {
    description: "Scan loaded terrain. Use summary/heightmap for terrain, collision for walkability, lighting for dark areas, and full only for exact blocks.",
    inputSchema: {
      from: position.describe("Inclusive minimum or maximum corner; Y limits the vertical search range"),
      to: position.describe("Opposite inclusive corner; Y limits the vertical search range"),
      mode: z.enum(["summary", "heightmap", "collision", "lighting", "full"]).default("summary"),
    },
  },
  async ({ from, to, mode }) => result(await withClient((client) => client.scan(from, to, mode))),
);

server.registerTool(
  "mc_validate_access",
  {
    description: "Search the actual world's collision geometry for ordinary-player routes from one start to multiple goals.",
    inputSchema: {
      from: position.describe("Inclusive minimum or maximum search corner"),
      to: position.describe("Opposite inclusive search corner"),
      start: position.describe("Player feet cell at the route start"),
      goals: z.array(position.describe("Player feet cell at a required destination")).min(1).max(32),
      height: z.number().int().min(1).max(4).default(2),
      maxStepUp: z.number().int().min(0).max(2).default(1),
      maxDrop: z.number().int().min(0).max(8).default(1),
      maxVisited: z.number().int().min(1).max(262144).default(100000),
    },
  },
  async ({ from, to, start, goals, height, maxStepUp, maxDrop, maxVisited }) => result(
    await withClient((client) => client.validateAccess(
      from, to, start, goals, height, maxStepUp, maxDrop, maxVisited,
    )),
  ),
);

server.registerTool(
  "mc_compare_blueprint",
  {
    description: "Compare final blueprint cuboids with actual world blocks and report missing, unexpected, and state-mismatched cells.",
    inputSchema: {
      operations: z.array(cuboid).min(1).max(256),
      ignoreState: z.boolean().default(false).describe("Compare base block IDs without directional or other state properties"),
      maxDifferences: z.number().int().min(0).max(2048).default(128),
    },
  },
  async ({ operations, ignoreState, maxDifferences }) => result(
    await withClient((client) => client.compareBlueprint(operations, ignoreState, maxDifferences)),
  ),
);

server.registerTool(
  "mc_apply_blueprint",
  {
    description: "Atomically apply up to 256 cuboid operations and 262,144 unique blocks as one persistent undo transaction.",
    inputSchema: {
      operations: z.array(cuboid).min(1).max(256),
      label: z.string().max(120).optional(),
      projectId,
      dryRun: z.boolean().default(false).describe("Analyze exact changes, materials, and hazards without modifying the world"),
    },
  },
  async ({ operations, label, projectId, dryRun }) => result(
    await withClient((client) => client.apply(operations, label, projectId, dryRun)),
  ),
);

server.registerTool(
  "mc_preview_blueprint",
  {
    description: "Preview exact bounds, changed blocks, materials, unloaded chunks, block entities, and player collisions without building.",
    inputSchema: {
      operations: z.array(cuboid).min(1).max(256),
      label: z.string().max(120).optional(),
    },
  },
  async ({ operations, label }) => result(await withClient((client) => client.apply(operations, label, undefined, true))),
);

server.registerTool(
  "mc_transform_region",
  {
    description: "Copy, rotate, mirror, or array an existing region while rotating directional block states.",
    inputSchema: {
      from: position,
      to: position,
      target: position.describe("Destination of the transformed minimum corner"),
      rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
      mirror: z.enum(["none", "x", "z"]).default("none"),
      copies: z.number().int().min(1).max(64).default(1),
      spacing: position.default({ x: 0, y: 0, z: 0 }).describe("Offset added between array copies"),
      includeAir: z.boolean().default(false),
      label: z.string().max(120).optional(),
      projectId,
      dryRun: z.boolean().default(false),
    },
  },
  async (options) => result(await withClient((client) => client.transform(options))),
);

server.registerTool(
  "mc_replace_blocks",
  {
    description: "Replace matching block IDs or exact block states inside a region, with optional dry-run preview.",
    inputSchema: {
      from: position,
      to: position,
      match: z.array(blockState).min(1).max(64),
      block: blockState,
      label: z.string().max(120).optional(),
      projectId,
      dryRun: z.boolean().default(false),
    },
  },
  async ({ from, to, match, block, label, projectId, dryRun }) => result(
    await withClient((client) => client.replace(from, to, match, block, label, projectId, dryRun)),
  ),
);

server.registerTool(
  "mc_build_box",
  {
    description: "Build a solid, hollow, or edge-only cuboid as one previewable and undoable transaction.",
    inputSchema: {
      from: position,
      to: position,
      block: blockState,
      mode: z.enum(["solid", "hollow", "outline"]).default("hollow"),
      label: z.string().max(120).optional(),
      projectId,
      dryRun: z.boolean().default(false),
    },
  },
  async ({ from, to, block, mode, label, projectId, dryRun }) => {
    const operations = boxOperations(from, to, block, mode);
    return result(await withClient((client) => client.apply(
      operations, label ?? `${mode} box`, projectId, dryRun,
    )));
  },
);

server.registerTool(
  "mc_fill",
  {
    description: "Fill an inclusive loaded cuboid with a Minecraft block and create an undo transaction.",
    inputSchema: {
      from: position,
      to: position,
      block: blockState,
    },
  },
  async ({ from, to, block }) => result(await withClient((client) => client.fill(from, to, block))),
);

server.registerTool(
  "mc_build_walls",
  {
    description: "Build four perimeter walls around an inclusive box as one undoable transaction.",
    inputSchema: {
      from: position,
      to: position,
      block: blockState,
      thickness: z.number().int().min(1).max(8).default(1),
      label: z.string().max(120).optional(),
      projectId,
      dryRun: z.boolean().default(false),
    },
  },
  async ({ from, to, block, thickness, label, projectId, dryRun }) => {
    const { min, max } = bounds(from, to);
    const t = Math.min(thickness, Math.ceil((max.x - min.x + 1) / 2), Math.ceil((max.z - min.z + 1) / 2));
    const operations: FillOperation[] = [
      { from: min, to: { x: max.x, y: max.y, z: min.z + t - 1 }, block },
      { from: { x: min.x, y: min.y, z: max.z - t + 1 }, to: max, block },
      { from: { x: min.x, y: min.y, z: min.z + t }, to: { x: min.x + t - 1, y: max.y, z: max.z - t }, block },
      { from: { x: max.x - t + 1, y: min.y, z: min.z + t }, to: { x: max.x, y: max.y, z: max.z - t }, block },
    ].filter(validCuboid);
    return result(await withClient((client) => client.apply(
      operations, label ?? "perimeter walls", projectId, dryRun,
    )));
  },
);

server.registerTool(
  "mc_build_columns",
  {
    description: "Build a set of vertical square columns as one undoable transaction.",
    inputSchema: {
      bases: z.array(position).min(1).max(128),
      height: z.number().int().min(1).max(128),
      width: z.number().int().min(1).max(8).default(1),
      block: blockState,
      label: z.string().max(120).optional(),
      projectId,
      dryRun: z.boolean().default(false),
    },
  },
  async ({ bases, height, width, block, label, projectId, dryRun }) => {
    const operations = bases.map((base) => ({
      from: base,
      to: { x: base.x + width - 1, y: base.y + height - 1, z: base.z + width - 1 },
      block,
    }));
    return result(await withClient((client) => client.apply(
      operations, label ?? "columns", projectId, dryRun,
    )));
  },
);

server.registerTool(
  "mc_build_gable_roof",
  {
    description: "Build a stepped gable roof over a rectangular footprint as one undoable transaction.",
    inputSchema: {
      from: position.describe("One base corner at eave height"),
      to: position.describe("Opposite base corner at eave height"),
      ridgeAxis: z.enum(["x", "z"]).describe("Axis along which the roof ridge runs"),
      block: blockState,
      label: z.string().max(120).optional(),
      projectId,
      dryRun: z.boolean().default(false),
    },
  },
  async ({ from, to, ridgeAxis, block, label, projectId, dryRun }) => {
    const { min, max } = bounds(from, to);
    const operations: FillOperation[] = [];
    const crossMin = ridgeAxis === "x" ? min.z : min.x;
    const crossMax = ridgeAxis === "x" ? max.z : max.x;
    const layers = Math.ceil((crossMax - crossMin + 1) / 2);
    if (layers * 2 > 256) return result({ error: "Roof footprint is too wide for one blueprint" });
    for (let layer = 0; layer < layers; layer++) {
      const low = crossMin + layer;
      const high = crossMax - layer;
      const y = min.y + layer;
      if (ridgeAxis === "x") {
        operations.push({ from: { x: min.x, y, z: low }, to: { x: max.x, y, z: low }, block });
        if (high !== low) operations.push({ from: { x: min.x, y, z: high }, to: { x: max.x, y, z: high }, block });
      } else {
        operations.push({ from: { x: low, y, z: min.z }, to: { x: low, y, z: max.z }, block });
        if (high !== low) operations.push({ from: { x: high, y, z: min.z }, to: { x: high, y, z: max.z }, block });
      }
    }
    return result(await withClient((client) => client.apply(
      operations, label ?? "gable roof", projectId, dryRun,
    )));
  },
);

server.registerTool(
  "mc_build_circle",
  {
    description: "Build a filled disc or hollow circle in a horizontal or vertical plane as one undoable transaction.",
    inputSchema: {
      center: position,
      radius: z.number().int().min(1).max(48),
      plane: z.enum(["xz", "xy", "yz"]).default("xz"),
      block: blockState,
      filled: z.boolean().default(false),
      thickness: z.number().int().min(1).max(8).default(1),
      label: z.string().max(120).optional(),
      projectId,
      dryRun: z.boolean().default(false),
    },
  },
  async ({ center, radius, plane, block, filled, thickness, label, projectId, dryRun }) => applyGeometry(
    circleOperations(center, radius, plane, block, filled, Math.min(thickness, radius)),
    label ?? (filled ? "filled circle" : "circle"),
    projectId,
    dryRun,
  ),
);

server.registerTool(
  "mc_build_curved_wall",
  {
    description: "Build a circular-arc wall between two angles as one undoable transaction.",
    inputSchema: {
      center: position.describe("Arc center at the wall's base Y"),
      radius: z.number().int().min(2).max(64),
      startAngle: z.number().min(-3600).max(3600).describe("Degrees; 0 points east and 90 points south"),
      endAngle: z.number().min(-3600).max(3600),
      height: z.number().int().min(1).max(128),
      thickness: z.number().int().min(1).max(8).default(1),
      block: blockState,
      label: z.string().max(120).optional(),
      projectId,
      dryRun: z.boolean().default(false),
    },
  },
  async ({ center, radius, startAngle, endAngle, height, thickness, block, label, projectId, dryRun }) => applyGeometry(
    curvedWallOperations(center, radius, startAngle, endAngle, height, Math.min(thickness, radius), block),
    label ?? "curved wall",
    projectId,
    dryRun,
  ),
);

server.registerTool(
  "mc_build_dome",
  {
    description: "Build a filled or hollow upper hemisphere from its base center as one undoable transaction.",
    inputSchema: {
      center: position.describe("Center of the dome's base"),
      radius: z.number().int().min(2).max(16),
      block: blockState,
      filled: z.boolean().default(false),
      thickness: z.number().int().min(1).max(8).default(1),
      label: z.string().max(120).optional(),
      projectId,
      dryRun: z.boolean().default(false),
    },
  },
  async ({ center, radius, block, filled, thickness, label, projectId, dryRun }) => applyGeometry(
    domeOperations(center, radius, block, filled, Math.min(thickness, radius)),
    label ?? (filled ? "filled dome" : "dome"),
    projectId,
    dryRun,
  ),
);

server.registerTool(
  "mc_build_spiral_stairs",
  {
    description: "Build a spiral staircase; stair blocks receive a tangent-facing state automatically when no state is supplied.",
    inputSchema: {
      center: position.describe("Spiral center at the first step's Y"),
      radius: z.number().int().min(1).max(16),
      height: z.number().int().min(1).max(128),
      turns: z.number().min(0.25).max(8).default(1),
      clockwise: z.boolean().default(true),
      block: blockState,
      label: z.string().max(120).optional(),
      projectId,
      dryRun: z.boolean().default(false),
    },
  },
  async ({ center, radius, height, turns, clockwise, block, label, projectId, dryRun }) => applyGeometry(
    spiralStairOperations(center, radius, height, turns, clockwise, block),
    label ?? "spiral stairs",
    projectId,
    dryRun,
  ),
);

server.registerTool(
  "mc_camera_begin",
  {
    description: "Save the player's position, view, game mode, and FOV before temporary inspection movement.",
    inputSchema: { spectator: z.boolean().default(true) },
  },
  async ({ spectator }) => result(await withClient((client) => client.beginCamera(spectator))),
);

server.registerTool(
  "mc_camera_move",
  {
    description: "Move an active inspection camera and optionally set yaw, pitch, and FOV.",
    inputSchema: {
      position: cameraPosition.optional(),
      yaw: z.number().min(-3600).max(3600).optional(),
      pitch: z.number().min(-90).max(90).optional(),
      fov: z.number().int().min(30).max(110).optional(),
    },
  },
  async ({ position, yaw, pitch, fov }) => result(
    await withClient((client) => client.moveCamera(position, yaw, pitch, fov)),
  ),
);

server.registerTool(
  "mc_camera_restore",
  {
    description: "Restore the player state saved by mc_camera_begin and end the inspection session.",
  },
  async () => result(await withClient((client) => client.restoreCamera())),
);

server.registerTool(
  "mc_capture_view",
  { description: "Capture the current Minecraft framebuffer and return it as a PNG image." },
  async () => {
    const capture = await withClient((client) => client.screenshot());
    if (typeof capture !== "object" || capture === null || "error" in capture) return result(capture);
    const screenshot = capture as { path: string; mediaType: string; screen: string };
    const data = await readFile(screenshot.path, { encoding: "base64" });
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({ path: screenshot.path, screen: screenshot.screen }) },
        { type: "image" as const, data, mimeType: screenshot.mediaType },
      ],
    };
  },
);

server.registerTool(
  "mc_capture_inspection",
  {
    description: "Capture multiple stabilized inspection views in one restorable camera session.",
    inputSchema: {
      views: z.array(z.object({
        name: z.string().min(1).max(80),
        position: cameraPosition,
        yaw: z.number().min(-3600).max(3600),
        pitch: z.number().min(-90).max(90),
        fov: z.number().int().min(30).max(110).default(70),
      })).min(1).max(12),
      settleMs: z.number().int().min(250).max(5000).default(1000),
    },
  },
  async ({ views, settleMs }) => {
    const captures: Array<{ name: string; path: string; screen: string; data: string; mediaType: string }> = [];
    let client: MinecraftClient | undefined;
    let began = false;
    try {
      client = await MinecraftClient.create();
      await client.beginCamera(true);
      began = true;
      for (const view of views) {
        await client.moveCamera(view.position, view.yaw, view.pitch, view.fov);
        await delay(settleMs);
        const shot = await client.screenshot();
        captures.push({
          name: view.name,
          path: shot.path,
          screen: shot.screen,
          mediaType: shot.mediaType,
          data: await readFile(shot.path, { encoding: "base64" }),
        });
      }
    } catch (error) {
      return result({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (began && client) {
        try { await client.restoreCamera(); } catch { /* Preserve the capture error; the session remains recoverable. */ }
      }
    }
    return {
      content: captures.flatMap((capture) => [
        { type: "text" as const, text: JSON.stringify({ name: capture.name, path: capture.path, screen: capture.screen }) },
        { type: "image" as const, data: capture.data, mimeType: capture.mediaType },
      ]),
    };
  },
);

server.registerTool(
  "mc_list_transactions",
  { description: "List persistent undo transactions newest first, including project grouping." },
  async () => result(await withClient((client) => client.transactions())),
);

server.registerTool(
  "mc_start_build_job",
  {
    description: "Start a persistent background build processed in per-tick batches with progress and cancellation.",
    inputSchema: {
      operations: z.array(cuboid).min(1).max(256),
      label: z.string().max(120).optional(),
      projectId,
    },
  },
  async ({ operations, label, projectId }) => result(
    await withClient((client) => client.startJob(operations, label, projectId)),
  ),
);

server.registerTool(
  "mc_build_job_status",
  { description: "Get progress and state for the active persistent build job." },
  async () => result(await withClient((client) => client.jobStatus())),
);

server.registerTool(
  "mc_control_build_job",
  {
    description: "Pause, resume, or cancel the active build job. Cancel restores its checkpoint.",
    inputSchema: {
      action: z.enum(["pause", "resume", "cancel"]),
      jobId: z.string().uuid().optional(),
    },
  },
  async ({ action, jobId }) => result(await withClient((client) => client.controlJob(action, jobId))),
);

server.registerTool(
  "mc_undo",
  {
    description: "Undo the newest transaction, or the newest contiguous group sharing a project ID.",
    inputSchema: { transactionId: z.string().uuid().optional(), projectId },
  },
  async ({ transactionId, projectId }) => result(await withClient((client) => client.undo(transactionId, projectId))),
);

async function withClient(action: (client: MinecraftClient) => Promise<unknown>): Promise<unknown> {
  try {
    return await action(await MinecraftClient.create());
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function result(value: unknown) {
  const failed = typeof value === "object" && value !== null && "error" in value;
  return {
    isError: failed,
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function bounds(a: Position, b: Position): { min: Position; max: Position } {
  return {
    min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
    max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
  };
}

function validCuboid(operation: FillOperation): boolean {
  return operation.from.x <= operation.to.x
    && operation.from.y <= operation.to.y
    && operation.from.z <= operation.to.z;
}

async function applyGeometry(operations: FillOperation[], label: string, projectId?: string, dryRun = false) {
  if (operations.length === 0) return result({ error: "Geometry produced no blocks" });
  if (operations.length > 256) {
    return result({
      error: `Geometry requires ${operations.length} cuboids, exceeding the 256 operation limit`,
      suggestedAction: "Reduce radius or thickness, or split the shape into multiple builds",
    });
  }
  return result(await withClient((client) => client.apply(operations, label, projectId, dryRun)));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

await server.connect(new StdioServerTransport());
