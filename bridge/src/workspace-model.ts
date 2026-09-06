import { z } from "zod";
import type { FillOperation, Position } from "./client.js";
import { normalizeOperation } from "./project-plan.js";

const coordinate = z.number().int().min(-30_000_000).max(30_000_000);
export const point = z.object({ x: coordinate, y: coordinate, z: coordinate }).strict();
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).refine(v => v !== "__remove", "Reserved internal stage name");
const facing = z.enum(["north", "east", "south", "west", "up", "down"]);
export const operation = z.object({ from: point, to: point, block: z.string().min(3).max(300), stage: id.optional() }).strict();
export const port = z.object({ id, kind: z.enum(["input", "output", "probe", "anchor"]),
  positions: z.array(point).min(1).max(64), facing: facing.default("up"),
  sample: z.enum(["north", "east", "south", "west", "up", "down", "wire", "received"]).default("received") }).strict();
const body = { operations: z.array(operation).default([]), ports: z.array(port).default([]) };
export const moduleSchema = z.object({ id, name: z.string().max(160), kind: z.string().max(80).default("module"),
  parent: id.optional(), template: id.optional(), stage: id.default("main"),
  offset: point.default({ x: 0, y: 0, z: 0 }), rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  ...body }).strict();
export const workspaceSchema = z.object({ format: z.literal("mcengineer/workspace/1"),
  projectId: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/), name: z.string().max(160),
  worldId: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/), dimension: z.string().regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+$/),
  origin: point.default({ x: 0, y: 0, z: 0 }), statePolicy: z.enum(["exact", "redstone"]).default("exact"),
  stages: z.array(z.object({ id, dependsOn: z.array(id).default([]) }).strict()).min(1).default([{ id: "main", dependsOn: [] }]),
  templates: z.record(id, z.object(body).strict()).default({}), modules: z.array(moduleSchema).default([]),
  connections: z.array(z.object({ id, from: z.string(), to: z.string() }).strict()).default([]),
}).strict();
export type Workspace = z.infer<typeof workspaceSchema>;
export type Module = z.infer<typeof moduleSchema>;
export type ResolvedOperation = FillOperation & { moduleId: string; stage: string };
export type ResolvedPort = z.infer<typeof port> & { moduleId: string; ref: string };
export type ResolvedModule = { id: string; name: string; kind: string; parent?: string; offset: Position; rotation: number;
  bounds?: { from: Position; to: Position }; operationCount: number };

export function stageOrder(stages: Workspace["stages"]): string[] {
  const map = new Map(stages.map(s => [s.id, s]));
  if (map.size !== stages.length) throw new Error("Duplicate stage IDs");
  const visiting = new Set<string>(), visited = new Set<string>(), result: string[] = [];
  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Stage dependency cycle at ${id}`);
    const stage = map.get(id); if (!stage) throw new Error(`Unknown stage ${id}`);
    visiting.add(id); stage.dependsOn.forEach(visit); visiting.delete(id); visited.add(id); result.push(id);
  }
  stages.forEach(s => visit(s.id)); return result;
}
export function rotatePoint(p: Position, degrees: number): Position {
  const turns = ((degrees / 90) % 4 + 4) % 4;
  if (turns === 1) return { x: -p.z, y: p.y, z: p.x };
  if (turns === 2) return { x: -p.x, y: p.y, z: -p.z };
  if (turns === 3) return { x: p.z, y: p.y, z: -p.x };
  return { ...p };
}
export const add = (a: Position, b: Position): Position => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const compass = ["north", "east", "south", "west"];
export function rotateDirection(direction: string, degrees: number): string {
  const index = compass.indexOf(direction); return index < 0 ? direction : compass[(index + degrees / 90) % 4];
}
export function rotateState(state: string, degrees: number): string {
  if (!state.includes("[")) return state;
  const match = /^([^[]+)\[([^\]]*)\]$/.exec(state); if (!match) throw new Error(`Invalid state ${state}`);
  const props = new Map<string, string>(), seen = new Set<string>();
  for (const assignment of match[2].split(",")) {
    let [key, value, extra] = assignment.split("="); if (!key || value === undefined || extra !== undefined || seen.has(key)) throw new Error(`Invalid state ${state}`);
    seen.add(key);
    if (compass.includes(key)) key = rotateDirection(key, degrees);
    if (["facing", "horizontal_facing"].includes(key)) value = rotateDirection(value, degrees);
    if (key === "axis" && degrees % 180 !== 0 && ["x", "z"].includes(value)) value = value === "x" ? "z" : "x";
    if (key === "rotation") {
      if (!/^\d+$/.test(value) || Number(value) > 15) throw new Error(`Invalid rotation state ${state}`);
      value = String((Number(value) + degrees / 90 * 4) % 16);
    }
    if (key === "orientation") value = value.split("_").map(v => rotateDirection(v, degrees)).join("_");
    if (key === "shape" && match[1].endsWith("rail")) {
      if (["north_south", "east_west"].includes(value)) {
        if (degrees % 180 !== 0) value = value === "north_south" ? "east_west" : "north_south";
      } else if (value.startsWith("ascending_")) value = "ascending_" + rotateDirection(value.slice(10), degrees);
      else {
        const directions = value.split("_").map(v => rotateDirection(v, degrees));
        value = ["north_east", "north_west", "south_east", "south_west"].find(v => v.split("_").every(d => directions.includes(d))) ?? value;
      }
    }
    props.set(key, value);
  }
  return match[1] + "[" + [...props].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(",") + "]";
}

export function resolveWorkspace(input: unknown) {
  const source = workspaceSchema.parse(input), order = stageOrder(source.stages);
  const byId = new Map(source.modules.map(m => [m.id, m]));
  if (byId.size !== source.modules.length) throw new Error("Duplicate module IDs");
  const transforms = new Map<string, { offset: Position; rotation: number }>(), active = new Set<string>();
  function transform(id: string): { offset: Position; rotation: number } {
    const cached = transforms.get(id); if (cached) return cached;
    if (active.has(id)) throw new Error(`Module parent cycle at ${id}`);
    const module = byId.get(id); if (!module) throw new Error(`Unknown parent module ${id}`);
    active.add(id);
    const parent = module.parent ? transform(module.parent) : { offset: source.origin, rotation: 0 };
    const value = { offset: add(parent.offset, rotatePoint(module.offset, parent.rotation)), rotation: (parent.rotation + module.rotation) % 360 };
    active.delete(id); transforms.set(id, value); return value;
  }
  const operations: ResolvedOperation[] = [], ports: ResolvedPort[] = [], modules: ResolvedModule[] = [];
  for (const module of source.modules) {
    const t = transform(module.id), template = module.template ? source.templates[module.template] : undefined;
    if (module.template && !template) throw new Error(`Unknown template ${module.template}`);
    const ops = [...template?.operations ?? [], ...module.operations].map(raw => {
      const stage = raw.stage ?? module.stage;
      if (!order.includes(stage)) throw new Error(`Unknown stage ${stage} on ${module.id}`);
      return { ...normalizeOperation({ from: add(t.offset, rotatePoint(raw.from, t.rotation)),
        to: add(t.offset, rotatePoint(raw.to, t.rotation)), block: rotateState(raw.block, t.rotation) }), stage, moduleId: module.id };
    });
    const seen = new Set<string>();
    for (const p of [...template?.ports ?? [], ...module.ports]) {
      if (seen.has(p.id)) throw new Error(`Duplicate port ${module.id}.${p.id}`); seen.add(p.id);
      ports.push({ ...p, positions: p.positions.map(pos => add(t.offset, rotatePoint(pos, t.rotation))),
        facing: rotateDirection(p.facing, t.rotation) as ResolvedPort["facing"], sample: rotateDirection(p.sample, t.rotation) as ResolvedPort["sample"], moduleId: module.id, ref: `${module.id}.${p.id}` });
    }
    operations.push(...ops);
    modules.push({ id: module.id, name: module.name, kind: module.kind, parent: module.parent, ...t, bounds: operationBounds(ops), operationCount: ops.length });
  }
  const portMap = new Map(ports.map(p => [p.ref, p])), connectionIds = new Set<string>();
  const connections = source.connections.map(connection => {
    if (connectionIds.has(connection.id)) throw new Error(`Duplicate connection ${connection.id}`); connectionIds.add(connection.id);
    const from = portMap.get(connection.from), to = portMap.get(connection.to);
    if (!from || !to) throw new Error(`Unknown connection endpoint on ${connection.id}`);
    if (from.positions.length !== to.positions.length) throw new Error(`Bus width mismatch on ${connection.id}`);
    return { ...connection, width: from.positions.length, physicalWiringVerified: false };
  });
  // Stage order is explicit and stable; within a stage, source module/op order wins.
  operations.sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
  return { source, stages: order, modules, ports, connections, operations, bounds: operationBounds(operations) };
}
export function operationBounds(operations: FillOperation[]) {
  if (!operations.length) return undefined;
  const from = { x: Infinity, y: Infinity, z: Infinity }, to = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const op of operations) for (const axis of ["x", "y", "z"] as const) {
    from[axis] = Math.min(from[axis], op.from[axis]); to[axis] = Math.max(to[axis], op.to[axis]);
  }
  return { from, to };
}
