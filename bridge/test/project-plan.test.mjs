import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { indexSections, rasterizeSection, prepareProject, readPreparedProject, sectionFile } from "../dist/project-plan.js";
import { uploadProject } from "../dist/project-transfer.js";

function decode(section) {
  const cells = [];
  for (let i = 0; i < section.runs.length; i += 2) cells.push(...Array(section.runs[i + 1]).fill(section.palette[section.runs[i]]));
  assert.equal(cells.length, 4096);
  return cells;
}
const op = (from, to, block = "minecraft:stone") => ({ from, to, block });

test("spatial compilation matches ordered cuboids at negative coordinates, including explicit air and KEEP", () => {
  const operations = [
    op({ x: -17, y: 63, z: -1 }, { x: 17, y: 65, z: 1 }),
    op({ x: 0, y: 64, z: 0 }, { x: -16, y: 64, z: 0 }, "minecraft:air"),
    op({ x: -1, y: 64, z: 0 }, { x: -1, y: 64, z: 0 }, "minecraft:gold_block"),
  ];
  const reference = new Map();
  for (const raw of operations) {
    for (let x = Math.min(raw.from.x, raw.to.x); x <= Math.max(raw.from.x, raw.to.x); x++)
      for (let y = Math.min(raw.from.y, raw.to.y); y <= Math.max(raw.from.y, raw.to.y); y++)
        for (let z = Math.min(raw.from.z, raw.to.z); z <= Math.max(raw.from.z, raw.to.z); z++) reference.set(`${x},${y},${z}`, raw.block);
  }
  let count = 0;
  for (const [key, ops] of indexSections(operations)) {
    const { section, requested } = rasterizeSection(key, ops); count += requested;
    decode(section).forEach((state, i) => {
      const cell = `${section.x * 16 + i % 16},${section.y * 16 + Math.floor(i / 256)},${section.z * 16 + Math.floor(i / 16) % 16}`;
      assert.equal(state, reference.get(cell) ?? null, cell);
    });
  }
  assert.equal(count, reference.size);
});

test("deterministic prepared artifacts and resumable immutable uploads detect modified sections", async () => {
  const root = await mkdtemp(join(tmpdir(), "mcarchitect-plan-"));
  try {
    const source = join(root, "source.json");
    await writeFile(source, JSON.stringify({ projectId: "test", worldId: "world-a", dimension: "minecraft:overworld",
      operations: [op({ x: 0, y: 64, z: 0 }, { x: 31, y: 65, z: 31 })] }));
    const first = await prepareProject(source, root), second = await prepareProject(source, root);
    assert.equal(first.planId, second.planId);
    const manifest = await readPreparedProject(first.directory);
    assert.equal(manifest.requestedBlocks, 2048);
    let fail = true;
    const remote = new Map();
    const client = { async project(request) {
      if (request.action === "upload") {
        if (fail && request.index === 2) { fail = false; throw new Error("connection lost"); }
        if (remote.has(request.index)) assert.equal(remote.get(request.index), request.data);
        remote.set(request.index, request.data);
      }
    } };
    await assert.rejects(uploadProject(first.directory, client), /connection lost/);
    await uploadProject(first.directory, client);
    assert.equal(remote.size, 4);
    await writeFile(join(first.directory, "sections", sectionFile(0)), "{}");
    await assert.rejects(uploadProject(first.directory, client), /changed/);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + "mcarchitect-plan-"));
    await rm(root, { recursive: true, force: true });
  }
});
