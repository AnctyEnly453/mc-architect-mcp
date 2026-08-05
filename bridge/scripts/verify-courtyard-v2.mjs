import { mkdir, readFile, writeFile } from "node:fs/promises";

const DESIGN_PATH = "D:/AI WORK/006/output/forbidden-city-courtyard-v2-manifest.json";
const OUTPUT_PATH = "D:/AI WORK/006/output/forbidden-city-courtyard-v2-verification.json";
const CONFIG_PATH = "D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json";
const design = JSON.parse(await readFile(DESIGN_PATH, "utf8"));
const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
const headers = { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" };

const coreBounds = { from: { x: 620, y: 168, z: 245 }, to: { x: 940, y: 245, z: 359 } };
const bridgeBounds = { from: { x: 698, y: 169, z: 358 }, to: { x: 862, y: 178, z: 380 } };
const coreOperations = [
  { block: "minecraft:air", ...coreBounds },
  ...design.operations.filter((op) => op.phase.startsWith("build-")),
  ...design.operations.filter((op) => op.phase === "bridges"),
];
const bridgeOperations = design.operations.filter((op) => op.phase === "bridges");

function intersection(op, bounds) {
  const from = {
    x: Math.max(op.from.x, bounds.from.x),
    y: Math.max(op.from.y, bounds.from.y),
    z: Math.max(op.from.z, bounds.from.z),
  };
  const to = {
    x: Math.min(op.to.x, bounds.to.x),
    y: Math.min(op.to.y, bounds.to.y),
    z: Math.min(op.to.z, bounds.to.z),
  };
  return from.x <= to.x && from.y <= to.y && from.z <= to.z ? { block: op.block, from, to } : null;
}

function volume(bounds) {
  return (bounds.to.x - bounds.from.x + 1) * (bounds.to.y - bounds.from.y + 1) * (bounds.to.z - bounds.from.z + 1);
}

function split(bounds) {
  const lengths = ["x", "y", "z"].map((axis) => [axis, bounds.to[axis] - bounds.from[axis] + 1]);
  lengths.sort((a, b) => b[1] - a[1]);
  const axis = lengths[0][0];
  const middle = Math.floor((bounds.from[axis] + bounds.to[axis]) / 2);
  return [
    { from: { ...bounds.from }, to: { ...bounds.to, [axis]: middle } },
    { from: { ...bounds.from, [axis]: middle + 1 }, to: { ...bounds.to } },
  ];
}

function tilesFor(bounds, operations) {
  const pending = [bounds], finished = [];
  while (pending.length) {
    const tile = pending.pop();
    const clipped = operations.map((op) => intersection(op, tile)).filter(Boolean);
    if ((volume(tile) > 180000 || clipped.length > 220) && volume(tile) > 1) pending.push(...split(tile));
    else finished.push({ bounds: tile, operations: clipped });
  }
  return finished;
}

async function post(path, body) {
  const response = await fetch(`http://127.0.0.1:${config.port}${path}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${result.error ?? response.statusText}`);
  return result;
}

const tiles = [
  ...tilesFor(coreBounds, coreOperations).map((tile) => ({ ...tile, group: "core" })),
  ...tilesFor(bridgeBounds, bridgeOperations).map((tile) => ({ ...tile, group: "bridges" })),
];
const results = [];
await post("/v1/camera/begin", { spectator: true });
try {
  for (let index = 0; index < tiles.length; index++) {
    const tile = tiles[index];
    await post("/v1/camera/move", {
      position: {
        x: (tile.bounds.from.x + tile.bounds.to.x) / 2,
        y: 250,
        z: (tile.bounds.from.z + tile.bounds.to.z) / 2,
      },
      pitch: 90,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const comparison = await post("/v1/compare", {
      operations: tile.operations,
      ignoreState: true,
      maxDifferences: 2048,
    });
    results.push({ index: index + 1, group: tile.group, ...tile.bounds, operationCount: tile.operations.length, comparison });
  }
} finally {
  await post("/v1/camera/restore", {});
}

const isDynamicSnow = (difference) => difference.kind === "unexpected"
  && difference.expected === "minecraft:air"
  && difference.actual?.startsWith("minecraft:snow");
const architecturalDifferences = results.flatMap((item) => item.comparison.differences
  .filter((difference) => !isDynamicSnow(difference))
  .map((difference) => ({ tile: item.index, group: item.group, ...difference })));
const dynamicSnowDifferences = results.flatMap((item) => item.comparison.differences.filter(isDynamicSnow));
const truncatedTiles = results.filter((item) => item.comparison.differencesTruncated).map((item) => item.index);
const summary = {
  passed: architecturalDifferences.length === 0 && truncatedTiles.length === 0,
  tileCount: results.length,
  coreTiles: results.filter((item) => item.group === "core").length,
  bridgeTiles: results.filter((item) => item.group === "bridges").length,
  comparedBlocks: results.reduce((sum, item) => sum + item.comparison.comparedBlocks, 0),
  differenceCount: architecturalDifferences.length,
  rawDifferenceCount: results.reduce((sum, item) => sum + item.comparison.differenceCount, 0),
  ignoredDynamicSnowCount: dynamicSnowDifferences.length,
  truncatedTiles,
  architecturalDifferences,
};
await mkdir("D:/AI WORK/006/output", { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({ summary, results }, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, output: OUTPUT_PATH }, null, 2));
