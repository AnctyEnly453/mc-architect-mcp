import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveWorkspace, point, type ResolvedPort } from "./workspace-model.js";
import { WorkspaceStore, atomicJSON } from "./workspace-store.js";
import { MinecraftClient } from "./client.js";
const value = z.union([z.boolean(), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), z.array(z.boolean()).min(1).max(64)]);
export const suiteSchema = z.object({ name: z.string().min(1).max(160),
  bounds: z.object({ from: point, to: point }).optional(), inputs: z.array(z.string()).max(64), probes: z.array(z.string()).min(1).max(64),
  events: z.array(z.object({ tick: z.number().int().nonnegative(), set: z.record(z.string(), value) })).max(4096),
  assertions: z.array(z.object({ tick: z.number().int().nonnegative(), port: z.string(), equals: value })).max(4096),
  durationTicks: z.number().int().min(1).max(48000), sampleEveryTicks: z.number().int().min(1).max(100).default(1),
}).strict();
function bits(input: z.infer<typeof value>, width: number): boolean[] {
  if (typeof input === "boolean") { if (width !== 1) throw new Error("Boolean requires a 1-bit port"); return [input]; }
  if (Array.isArray(input)) { if (input.length !== width) throw new Error("Bit array width mismatch"); return input; }
  if (BigInt(input) >= (1n << BigInt(width))) throw new Error("Value exceeds bus width");
  return Array.from({ length: width }, (_, i) => Boolean((BigInt(input) >> BigInt(i)) & 1n));
}
export function compileSuite(source: unknown, input: unknown, id = randomUUID()) {
  const model = resolveWorkspace(source), suite = suiteSchema.parse(input), ports = new Map(model.ports.map(p => [p.ref, p]));
  if (Math.floor(suite.durationTicks / suite.sampleEveryTicks) > 6000) throw new Error("At most 6001 trace frames; increase sampleEveryTicks for long runs");
  function selected(refs: string[], input: boolean) {
    if (new Set(refs).size !== refs.length) throw new Error("Duplicate suite port");
    return refs.map(ref => { const p = ports.get(ref); if (!p || (input ? p.kind !== "input" : !["output", "probe"].includes(p.kind))) throw new Error(`Invalid ${input ? "input" : "probe"} port ${ref}`); return p; });
  }
  const inputs = selected(suite.inputs, true), probes = selected(suite.probes, false);
  const flatten = (p: ResolvedPort) => p.positions.map((position, i) => ({ id: `${p.ref}[${i}]`, position, face: p.sample }));
  const nativeInputs = inputs.flatMap(flatten).map(({ face, ...p }) => p), nativeProbes = probes.flatMap(flatten);
  if (nativeInputs.length > 64 || nativeProbes.length > 64) throw new Error("At most 64 input bits and 64 probe bits per test");
  if (new Set(nativeInputs.map(p => JSON.stringify(p.position))).size !== nativeInputs.length) throw new Error("Inputs share a physical lever");
  // Bounds include circuit internals, not just endpoints. Large projects must select explicit test regions.
  const bounds = suite.bounds ?? model.bounds;
  if (!bounds) throw new Error("Test bounds required");
  const chunks = (Math.floor(bounds.to.x / 16) - Math.floor(bounds.from.x / 16) + 1) * (Math.floor(bounds.to.z / 16) - Math.floor(bounds.from.z / 16) + 1);
  if (chunks > 384 || ["x", "y", "z"].some(a => bounds.from[a as "x"] > bounds.to[a as "x"])) throw new Error("Choose an ordered test region of at most 384 chunks covering all circuit internals");
  for (const { position: p } of [...nativeInputs, ...nativeProbes]) if (["x", "y", "z"].some(a => p[a as "x"] < bounds.from[a as "x"] || p[a as "x"] > bounds.to[a as "x"])) throw new Error("Port outside test bounds");
  const seen = new Set<string>();
  const events = suite.events.map(e => {
    if (e.tick > suite.durationTicks) throw new Error("Event beyond test duration");
    const set: Record<string, boolean> = {};
    for (const [ref, v] of Object.entries(e.set)) {
      const p = inputs.find(p => p.ref === ref); if (!p) throw new Error(`Undeclared input ${ref}`);
      bits(v, p.positions.length).forEach((bit, i) => {
        const id = `${ref}[${i}]`, key = `${e.tick}:${id}`;
        if (seen.has(key)) throw new Error(`Duplicate stimulus ${key}`); seen.add(key); set[id] = bit;
      });
    }
    return { tick: e.tick, set };
  });
  const assertions = suite.assertions.flatMap(a => {
    if (a.tick > suite.durationTicks) throw new Error("Assertion beyond test duration");
    const p = probes.find(p => p.ref === a.port); if (!p) throw new Error(`Undeclared probe ${a.port}`);
    return bits(a.equals, p.positions.length).map((bit, i) => ({ tick: a.tick, probe: `${a.port}[${i}]`, min: bit ? 1 : 0, max: bit ? 15 : 0 }));
  });
  if (assertions.length > 4096) throw new Error("At most 4096 bit assertions per test");
  return { id, name: suite.name, worldId: model.source.worldId, dimension: model.source.dimension, bounds,
    inputs: nativeInputs, probes: nativeProbes, events, assertions, durationTicks: suite.durationTicks, sampleEveryTicks: suite.sampleEveryTicks };
}
export async function startSuite(store: WorkspaceStore, client: Pick<MinecraftClient, "circuit">, input: unknown) {
  const revision = await store.read(), spec = compileSuite(revision.source, input);
  const directory = join(store.directory, "tests", spec.id); await mkdir(directory, { recursive: true });
  await atomicJSON(join(directory, "request.json"), { revisionId: revision.id, suite: input, spec });
  await atomicJSON(join(store.directory, "LAST_TEST.json"), { id: spec.id, directory });
  return { id: spec.id, directory, engine: await client.circuit({ action: "start", ...spec }) };
}
