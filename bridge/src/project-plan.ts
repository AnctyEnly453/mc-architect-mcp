import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { FillOperation } from "./client.js";

const coordinate = z.number().int().min(-30_000_000).max(30_000_000);
const position = z.object({ x: coordinate, y: coordinate, z: coordinate }).strict();
const block = z.string().max(300).regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+(?:\[[a-z0-9_=,.-]+\])?$/);
export const projectSourceSchema = z.object({
  projectId: z.string().regex(/^[A-Za-z0-9._-]{1,120}$/),
  worldId: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/),
  dimension: z.string().max(100).regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+$/),
  operations: z.array(z.object({ from: position, to: position, block }).passthrough()).min(1),
  expectedOperations: z.array(z.object({ from: position, to: position, block }).strict()).default([]),
  statePolicy: z.enum(["exact", "redstone"]).default("exact"),
}).passthrough();

export type SectionPlan = {
  x: number; y: number; z: number;
  // Palette index zero always means KEEP. Air is an ordinary, explicit palette entry.
  palette: Array<string | null>;
  runs: number[]; // [palette index, length, ...], X then Z then Y, exactly 4096 cells.
  statePolicy?: "redstone";
  expected?: { palette: Array<string | null>; runs: number[] };
};
export type ProjectManifest = {
  format: "mcarchitect-project/1";
  projectId: string; worldId: string; dimension: string;
  planId: string; sectionCount: number; requestedBlocks: number;
  hashes: string[];
  requiredCapabilities?: string[];
};
export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
export function planDigest(projectId: string, worldId: string, dimension: string, hashes: string[]): string {
  return sha256(JSON.stringify([projectId, worldId, dimension]) + "\n" + hashes.join("\n"));
}
export const sectionFile = (index: number) => `${String(index).padStart(8, "0")}.json`;

export function normalizeOperation(op: FillOperation): FillOperation {
  return {
    ...op,
    block: op.block,
    from: { x: Math.min(op.from.x, op.to.x), y: Math.min(op.from.y, op.to.y), z: Math.min(op.from.z, op.to.z) },
    to: { x: Math.max(op.from.x, op.to.x), y: Math.max(op.from.y, op.to.y), z: Math.max(op.from.z, op.to.z) },
  };
}

// Store cuboid references, never one JS object per world block. Each section is
// rasterized independently; insertion order preserves last-write-wins exactly.
export function indexSections(operations: FillOperation[], maxSections = 1_000_000): Map<string, FillOperation[]> {
  const sections = new Map<string, FillOperation[]>();
  let references = 0;
  for (const raw of operations) {
    const op = normalizeOperation(raw);
    const lo = [op.from.x, op.from.y, op.from.z].map(n => Math.floor(n / 16));
    const hi = [op.to.x, op.to.y, op.to.z].map(n => Math.floor(n / 16));
    const count = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
    if (count > maxSections || references + count > 8_000_000) {
      throw new Error("Plan exceeds compiler section/reference budget; split into spatial projects");
    }
    references += count;
    for (let z = lo[2]; z <= hi[2]; z++) for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) {
      const key = `${x},${y},${z}`;
      let bucket = sections.get(key);
      if (!bucket) {
        if (sections.size >= maxSections) throw new Error("Plan exceeds compiler section budget");
        sections.set(key, bucket = []);
      }
      bucket.push(op);
    }
  }
  return sections;
}

export function rasterizeSection(key: string, operations: FillOperation[]): { section: SectionPlan; requested: number } {
  const [sx, sy, sz] = key.split(",").map(Number);
  const cells = new Uint32Array(4096);
  const palette: Array<string | null> = [null];
  const ids = new Map<string, number>();
  for (const op of operations) {
    let id = ids.get(op.block);
    if (id === undefined) { id = palette.length; ids.set(op.block, id); palette.push(op.block); }
    for (let y = Math.max(op.from.y, sy * 16); y <= Math.min(op.to.y, sy * 16 + 15); y++) {
      for (let z = Math.max(op.from.z, sz * 16); z <= Math.min(op.to.z, sz * 16 + 15); z++) {
        const start = (y - sy * 16) * 256 + (z - sz * 16) * 16;
        cells.fill(id, start + Math.max(op.from.x, sx * 16) - sx * 16, start + Math.min(op.to.x, sx * 16 + 15) - sx * 16 + 1);
      }
    }
  }
  // Remove overwritten/unused palette entries so hashing reflects the final plan.
  const compact: Array<string | null> = [null];
  const remap = new Map<number, number>([[0, 0]]);
  const runs: number[] = [];
  let previous = -1, length = 0, requested = 0;
  for (const value of cells) {
    if (value !== 0) requested++;
    let id = remap.get(value);
    if (id === undefined) { id = compact.length; remap.set(value, id); compact.push(palette[value]); }
    if (id === previous) { length++; continue; }
    if (length) runs.push(previous, length);
    previous = id; length = 1;
  }
  runs.push(previous, length);
  return { section: { x: sx, y: sy, z: sz, palette: compact, runs }, requested };
}

export async function prepareProject(sourcePath: string, outputDirectory: string) {
  const source = projectSourceSchema.parse(JSON.parse(await readFile(resolve(sourcePath), "utf8")));
  if ([source.projectId, source.worldId, source.dimension].some(value => /[\r\n]/.test(value))) {
    throw new Error("Project identity cannot contain newlines");
  }
  const indexed = indexSections(source.operations);
  const expected = indexSections(source.expectedOperations);
  const keys = [...indexed.keys()].sort((a, b) => {
    const aa = a.split(",").map(Number), bb = b.split(",").map(Number);
    return aa[2] - bb[2] || aa[0] - bb[0] || aa[1] - bb[1];
  });
  const base = resolve(outputDirectory);
  await mkdir(base, { recursive: true });
  const staging = join(base, `preparing-${randomUUID()}`);
  await mkdir(join(staging, "sections"), { recursive: true });
  const hashes: string[] = [];
  let requestedBlocks = 0;
  for (let index = 0; index < keys.length; index++) {
    const { section, requested } = rasterizeSection(keys[index], indexed.get(keys[index])!);
    if (source.statePolicy === "redstone") section.statePolicy = "redstone";
    if (expected.has(keys[index])) {
      const before = rasterizeSection(keys[index], expected.get(keys[index])!).section;
      section.expected = { palette: before.palette, runs: before.runs };
    }
    expected.delete(keys[index]);
    indexed.delete(keys[index]);
    const text = JSON.stringify(section);
    if (Buffer.byteLength(JSON.stringify({ action: "upload", planId: "0".repeat(64), index, data: text })) > 250_000) {
      throw new Error(`Section ${keys[index]} has too many distinct block states for the upload envelope`);
    }
    hashes.push(sha256(text)); requestedBlocks += requested;
    await writeFile(join(staging, "sections", sectionFile(index)), text, "utf8");
  }
  const planId = planDigest(source.projectId, source.worldId, source.dimension, hashes);
  const manifest: ProjectManifest = {
    format: "mcarchitect-project/1", projectId: source.projectId, worldId: source.worldId,
    dimension: source.dimension, planId, sectionCount: keys.length, requestedBlocks, hashes,
    ...((source.expectedOperations.length || source.statePolicy === "redstone") ? { requiredCapabilities: ["project-guards-v1"] } : {}),
  };
  await writeFile(join(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  // A unique directory avoids replacing a prepared plan or a caller's files.
  const directory = join(base, `${planId.slice(0, 16)}-${randomUUID().slice(0, 8)}`);
  await rename(staging, directory);
  return { directory, planId, projectId: source.projectId, sectionCount: keys.length, requestedBlocks,
    maxResidentVoxelCells: 4096, semantics: "final composite; unspecified cells are preserved" };
}

export async function readPreparedProject(directory: string): Promise<ProjectManifest> {
  const manifest = JSON.parse(await readFile(join(resolve(directory), "manifest.json"), "utf8")) as ProjectManifest;
  if (manifest.format !== "mcarchitect-project/1" || !Array.isArray(manifest.hashes)
      || manifest.hashes.length !== manifest.sectionCount || manifest.sectionCount < 1
      || manifest.planId !== planDigest(manifest.projectId, manifest.worldId, manifest.dimension, manifest.hashes)) {
    throw new Error("Invalid or modified project manifest; prepare the source again");
  }
  return manifest;
}
