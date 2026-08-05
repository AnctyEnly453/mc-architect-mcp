import { mkdir, readFile, writeFile } from "node:fs/promises";

const PROJECT_ID = "forbidden-city-core-courtyard-v2";
const OUTPUT = "D:/AI WORK/006/output/forbidden-city-courtyard-v2-manifest.json";
const phases = { clear: [], build: [], bridges: [] };
let active = "build";
const add = (block, x1, y1, z1, x2, y2, z2) => phases[active].push({
  block,
  from: { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2) },
  to: { x: Math.max(x1, x2), y: Math.max(y1, y2), z: Math.max(z1, z2) },
});
const volume = (op) => (op.to.x - op.from.x + 1) * (op.to.y - op.from.y + 1) * (op.to.z - op.from.z + 1);
const symmetricPositions = (minimum, maximum, segments) => {
  const center = (minimum + maximum) / 2;
  const halfSpan = (maximum - minimum) / 2;
  return Array.from({ length: segments + 1 }, (_, index) => {
    const normalized = (index - segments / 2) / (segments / 2);
    const offset = Math.sign(normalized) * Math.round(Math.abs(normalized * halfSpan));
    return Math.round(center + offset);
  });
};

function ring(block, x1, y1, z1, x2, y2, z2, thickness = 1) {
  add(block, x1, y1, z1, x2, y2, z1 + thickness - 1);
  add(block, x1, y1, z2 - thickness + 1, x2, y2, z2);
  add(block, x1, y1, z1 + thickness, x1 + thickness - 1, y2, z2 - thickness);
  add(block, x2 - thickness + 1, y1, z1 + thickness, x2, y2, z2 - thickness);
}

function balustrade(x1, y, z1, x2, z2) {
  ring("minecraft:quartz_block", x1, y, z1, x2, y + 1, z2);
  const xBays = Math.max(1, Math.round((x2 - x1) / 7));
  for (const x of symmetricPositions(x1, x2, xBays)) {
    add("minecraft:diorite_wall", x, y + 2, z1, x, y + 3, z1);
    add("minecraft:diorite_wall", x, y + 2, z2, x, y + 3, z2);
  }
  const zBays = Math.max(1, Math.round((z2 - z1) / 7));
  for (const z of symmetricPositions(z1, z2, zBays)) {
    add("minecraft:diorite_wall", x1, y + 2, z, x1, y + 3, z);
    add("minecraft:diorite_wall", x2, y + 2, z, x2, y + 3, z);
  }
}

function roof(x1, z1, x2, z2, baseY, height, upper = false) {
  add("minecraft:dark_oak_planks", x1 - 6, baseY, z1 - 6, x2 + 6, baseY + 1, z2 + 6);
  add("minecraft:orange_terracotta", x1 - 4, baseY + 2, z1 - 4, x2 + 4, baseY + 3, z2 + 4);
  for (let i = 0; i < height; i++) {
    const ix = Math.floor(i * 1.45);
    if (x1 - 2 + ix > x2 + 2 - ix || z1 - 2 + i > z2 + 2 - i) break;
    add("minecraft:yellow_terracotta", x1 - 2 + ix, baseY + 4 + i, z1 - 2 + i,
      x2 + 2 - ix, baseY + 4 + i, z2 + 2 - i);
  }
  const ridgeY = baseY + height + 4;
  add("minecraft:gold_block", x1 + Math.floor(height * 1.3), ridgeY, Math.floor((z1 + z2) / 2) - 1,
    x2 - Math.floor(height * 1.3), ridgeY + 1, Math.floor((z1 + z2) / 2) + 1);
  if (!upper) return;
  const ux1 = x1 + 12, ux2 = x2 - 12, uz1 = z1 + 8, uz2 = z2 - 8;
  add("minecraft:dark_oak_planks", ux1, ridgeY - 1, uz1, ux2, ridgeY - 1, uz2);
  ring("minecraft:red_terracotta", ux1, ridgeY, uz1, ux2, ridgeY + 7, uz2, 2);
  add("minecraft:air", ux1 + 2, ridgeY + 1, uz1 + 2, ux2 - 2, ridgeY + 6, uz2 - 2);
  for (const z of [uz1, uz2]) {
    add("minecraft:black_stained_glass", ux1 + 8, ridgeY + 2, z, ux2 - 8, ridgeY + 5, z);
    const upperXBays = Math.max(2, Math.round((ux2 - ux1 - 16) / 12));
    for (const x of symmetricPositions(ux1 + 8, ux2 - 8, upperXBays)) {
      add("minecraft:dark_oak_log[axis=y]", x - 1, ridgeY + 1, z - 1, x + 1, ridgeY + 6, z + 1);
    }
  }
  const upperBase = ridgeY + 8;
  add("minecraft:dark_oak_planks", ux1 - 5, upperBase, uz1 - 5, ux2 + 5, upperBase + 1, uz2 + 5);
  add("minecraft:orange_terracotta", ux1 - 3, upperBase + 2, uz1 - 3, ux2 + 3, upperBase + 3, uz2 + 3);
  for (let i = 0; i < 8; i++) add("minecraft:yellow_terracotta", ux1 - 1 + i, upperBase + 4 + i, uz1 - 1 + i,
    ux2 + 1 - i, upperBase + 4 + i, uz2 + 1 - i);
  add("minecraft:gold_block", ux1 + 12, upperBase + 12, Math.floor((uz1 + uz2) / 2), ux2 - 12, upperBase + 13, Math.floor((uz1 + uz2) / 2) + 1);
}

function stairFlight(block, x1, x2, lowY, lowZ, riseTowardPositiveZ) {
  for (let i = 0; i < 3; i++) {
    const z = lowZ + (riseTowardPositiveZ ? i : -i);
    const facing = riseTowardPositiveZ ? "north" : "south";
    add(`${block}[facing=${facing},half=bottom,shape=straight,waterlogged=false]`,
      x1, lowY + i, z, x2, lowY + i, z);
  }
}

function hall(cx, cz, width, depth, bodyHeight, roofHeight, tiers, upper = false, primary = false) {
  const x1 = Math.round(cx - width / 2), x2 = Math.round(cx + width / 2);
  const z1 = Math.round(cz - depth / 2), z2 = Math.round(cz + depth / 2);
  for (let tier = 0; tier < tiers; tier++) {
    const expand = (tiers - tier) * 5;
    add(tier === 0 ? "minecraft:stone_bricks" : "minecraft:quartz_block",
      x1 - expand, 168 + tier * 3, z1 - expand, x2 + expand, 170 + tier * 3, z2 + expand);
    balustrade(x1 - expand, 170 + tier * 3, z1 - expand, x2 + expand, z2 + expand);
  }
  const base = 168 + tiers * 3;
  add("minecraft:dark_oak_planks", x1, base, z1, x2, base, z2);
  ring("minecraft:red_terracotta", x1, base + 1, z1, x2, base + bodyHeight, z2, 2);
  add("minecraft:air", x1 + 2, base + 2, z1 + 2, x2 - 2, base + bodyHeight - 2, z2 - 2);
  add("minecraft:dark_oak_planks", x1 + 2, base + 1, z1 + 2, x2 - 2, base + 1, z2 - 2);
  const bayCount = Math.max(2, Math.round((x2 - x1) / (primary ? 12 : 10)));
  for (const x of symmetricPositions(x1, x2, bayCount)) {
    add("minecraft:dark_oak_log[axis=y]", x - 1, base + 1, z1 - 1, x + 1, base + bodyHeight + 1, z1 + 1);
    add("minecraft:dark_oak_log[axis=y]", x - 1, base + 1, z2 - 1, x + 1, base + bodyHeight + 1, z2 + 1);
  }
  for (const z of [z1, z2]) {
    add("minecraft:black_stained_glass", x1 + 5, base + 6, z, cx - 8, base + bodyHeight - 3, z);
    add("minecraft:black_stained_glass", cx + 8, base + 6, z, x2 - 5, base + bodyHeight - 3, z);
  }
  for (const z of [z1, z2]) add("minecraft:air", cx - 5, base + 1, z - 2, cx + 5, base + 11, z + 2);
  add("minecraft:red_carpet", cx - 3, base + 2, z1 + 4, cx + 3, base + 2, z2 - 4);
  const lightY = base + bodyHeight - 3;
  const lightXBays = Math.max(2, Math.round((x2 - x1 - 20) / 18));
  const lightZBays = Math.max(2, Math.round((z2 - z1 - 20) / 18));
  for (const x of symmetricPositions(x1 + 10, x2 - 10, lightXBays)) {
    for (const z of symmetricPositions(z1 + 10, z2 - 10, lightZBays)) {
      add("minecraft:dark_oak_fence", x, lightY + 1, z, x, base + bodyHeight, z);
      add("minecraft:lantern[hanging=true,waterlogged=false]", x, lightY, z, x, lightY, z);
    }
  }
  roof(x1, z1, x2, z2, base + bodyHeight + 1, roofHeight, upper);
}

// Clear the complete old core layout in atomic-size tiles; the base at Y=167 remains.
active = "clear";
for (let x = 620; x <= 940; x += 60) {
  for (let z = 245; z <= 359; z += 50) {
    add("minecraft:air", x, 168, z, Math.min(940, x + 59), 245, Math.min(359, z + 49));
  }
}

// New core court: one dominant hall and two remote secondary halls.
active = "build";
add("minecraft:smooth_stone", 620, 168, 245, 940, 169, 359);
add("minecraft:polished_andesite", 774, 170, 245, 786, 170, 260);
add("minecraft:polished_andesite", 774, 170, 348, 786, 170, 359);
add("minecraft:polished_andesite", 675, 170, 348, 885, 170, 355);
hall(780, 304, 108, 56, 20, 14, 3, true, true);
hall(650, 300, 38, 52, 11, 7, 1, false, false);
hall(910, 300, 38, 52, 11, 7, 1, false, false);

// Broad, continuous ceremonial stairs make every main-hall podium tier traversable.
for (const [lowY, northLowZ, southLowZ] of [[171, 263, 345], [174, 268, 340]]) {
  stairFlight("minecraft:polished_andesite_stairs", 774, 786, lowY, northLowZ, true);
  stairFlight("minecraft:polished_andesite_stairs", 774, 786, lowY, southLowZ, false);
}

// Cut real openings through every balustrade layer instead of making players climb the rail.
for (const [y, northZ, southZ] of [[170, 261, 347], [173, 266, 342], [176, 271, 337]]) {
  add("minecraft:polished_andesite", 774, y, northZ, 786, y, northZ);
  add("minecraft:air", 774, y + 1, northZ, 786, y + 4, northZ);
  add("minecraft:polished_andesite", 774, y, southZ, 786, y, southZ);
  add("minecraft:air", 774, y + 1, southZ, 786, y + 4, southZ);
}
for (const cx of [650, 910]) {
  for (const z of [269, 331]) {
    add("minecraft:polished_andesite", cx - 5, 170, z, cx + 5, 170, z);
    add("minecraft:air", cx - 5, 171, z, cx + 5, 174, z);
  }
}

// Reassert carpets after all structural and clearance operations; gravity-sensitive decor is a finish layer.
add("minecraft:red_carpet", 777, 179, 280, 783, 179, 328);
add("minecraft:red_carpet", 647, 173, 278, 653, 173, 322);
add("minecraft:red_carpet", 907, 173, 278, 913, 173, 322);
for (const x of [732, 744, 756, 768, 780, 792, 804, 816, 828]) {
  for (const z of [280, 292, 304, 316, 328]) add("minecraft:light[level=15]", x, 181, z, x, 181, z);
}
for (const cx of [650, 910]) {
  for (const x of [cx - 12, cx, cx + 12]) {
    for (const z of [282, 294, 306, 318]) add("minecraft:light[level=15]", x, 176, z, x, 176, z);
  }
}

// Replace the five solid beams with hierarchical, supported bridges.
active = "bridges";
for (const x of [704, 742, 780, 818, 856]) add("minecraft:air", x - 6, 172, 358, x + 6, 178, 379);
for (const [cx, half] of [[704, 3], [742, 3], [780, 5], [818, 3], [856, 3]]) {
  for (let i = 0; i < 4; i++) add(`minecraft:quartz_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]`,
    cx - half, 169 + i, 359 + i, cx + half, 169 + i, 359 + i);
  add("minecraft:quartz_block", cx - half, 173, 363, cx + half, 173, 376);
  for (let i = 0; i < 3; i++) add(`minecraft:quartz_stairs[facing=south,half=bottom,shape=straight,waterlogged=false]`,
    cx - half, 172 - i, 377 + i, cx + half, 172 - i, 377 + i);
  add("minecraft:polished_andesite", cx - half, 169, 380, cx + half, 169, 380);
  for (const z of [367, 374]) add("minecraft:chiseled_stone_bricks", cx - half, 169, z, cx + half, 172, z + 1);
  add("minecraft:diorite_wall", cx - half, 174, 363, cx - half, 175, 376);
  add("minecraft:diorite_wall", cx + half, 174, 363, cx + half, 175, 376);
}
add("minecraft:polished_andesite", 769, 170, 359, 773, 170, 359);
add("minecraft:polished_andesite", 787, 170, 359, 791, 170, 359);

const buildings = [
  { id: "main-hall", bounds: { from: { x: 711, y: 168, z: 261 }, to: { x: 849, y: 240, z: 347 } } },
  { id: "west-hall", bounds: { from: { x: 625, y: 168, z: 268 }, to: { x: 675, y: 205, z: 332 } } },
  { id: "east-hall", bounds: { from: { x: 885, y: 168, z: 268 }, to: { x: 935, y: 205, z: 332 } } },
];
const gap = (a1, a2, b1, b2) => Math.max(b1 - a2 - 1, a1 - b2 - 1, 0);
const layoutChecks = [];
for (let i = 0; i < buildings.length; i++) for (let j = i + 1; j < buildings.length; j++) {
  const a = buildings[i], b = buildings[j];
  const gapX = gap(a.bounds.from.x, a.bounds.to.x, b.bounds.from.x, b.bounds.to.x);
  const gapZ = gap(a.bounds.from.z, a.bounds.to.z, b.bounds.from.z, b.bounds.to.z);
  const overlap = gapX === 0 && gapZ === 0;
  layoutChecks.push({ pair: [a.id, b.id], overlap, gapX, gapZ });
  if (overlap) throw new Error(`Layout overlap: ${a.id} / ${b.id}`);
}

await mkdir("D:/AI WORK/006/output", { recursive: true });
function batches(operations, maxGross = 180000, maxOps = 140) {
  const result = []; let current = [], gross = 0;
  for (const op of operations) {
    const v = volume(op);
    if (current.length && (current.length >= maxOps || gross + v > maxGross)) {
      result.push(current); current = []; gross = 0;
    }
    current.push(op); gross += v;
  }
  if (current.length) result.push(current);
  return result;
}
const buildDesignBatches = batches(phases.build);
const clearPhaseIds = phases.clear.map((_, index) => `clear-${index + 1}`);
const buildPhaseIds = buildDesignBatches.map((_, index) => `build-${index + 1}`);
const designOperations = [
  ...buildDesignBatches.flatMap((batch, index) => batch.map((op) => ({ ...op, phase: buildPhaseIds[index] }))),
  ...phases.bridges.map((op) => ({ ...op, phase: "bridges" })),
];
const design = {
  name: "forbidden-city-core-courtyard-v2",
  project: {
    id: PROJECT_ID,
    scale: "complex",
    worldId: "PCL-1.21.11",
    dimension: "minecraft:overworld",
    revision: 2,
  },
  bounds: { from: { x: 620, y: 167, z: 245 }, to: { x: 940, y: 245, z: 380 } },
  site: {
    datumY: 168,
    north: "-z",
    mainAxis: "z",
    protectedRegions: [
      { id: "meridian-gate", note: "outside edited core" },
      { id: "supreme-harmony-gate", from: { x: 620, y: 170, z: 380 }, to: { x: 940, y: 245, z: 387 } },
      { id: "golden-water-river", note: "retained outside five bridge footprints" },
      { id: "core-base", from: { x: 620, y: 167, z: 245 }, to: { x: 940, y: 167, z: 359 } },
    ],
  },
  style: {
    name: "chinese-imperial-central-court",
    module: 6,
    palette: {
      foundation: ["minecraft:stone_bricks", "minecraft:smooth_stone", "minecraft:polished_andesite"],
      structure: ["minecraft:red_terracotta", "minecraft:dark_oak_log[axis=y]"],
      roof: ["minecraft:yellow_terracotta", "minecraft:orange_terracotta"],
      trim: ["minecraft:dark_oak_planks", "minecraft:gold_block"],
      glazing: ["minecraft:black_stained_glass"],
      light: ["minecraft:lantern[hanging=true,waterlogged=false]"],
    },
  },
  buildings: buildings.map((building) => ({ ...building, floors: [`${building.id}-main-floor`] })),
  spaces: [
    { id: "south-court", kind: "exterior", exterior: true },
    { id: "north-court", kind: "exterior", exterior: true },
    { id: "main-hall-room", kind: "occupied", occupied: true, building: "main-hall", floor: "main-hall-main-floor" },
    { id: "west-hall-room", kind: "occupied", occupied: true, building: "west-hall", floor: "west-hall-main-floor" },
    { id: "east-hall-room", kind: "occupied", occupied: true, building: "east-hall", floor: "east-hall-main-floor" },
  ],
  portals: [
    { id: "main-south-door", kind: "opening", connects: ["south-court", "main-hall-room"], clearanceCheck: "main-south-door-clear" },
    { id: "main-north-door", kind: "opening", connects: ["north-court", "main-hall-room"], clearanceCheck: "main-north-door-clear" },
    { id: "west-south-door", kind: "opening", connects: ["south-court", "west-hall-room"], clearanceCheck: "west-south-door-clear" },
    { id: "east-south-door", kind: "opening", connects: ["south-court", "east-hall-room"], clearanceCheck: "east-south-door-clear" },
  ],
  defaultBlock: "minecraft:air",
  movementProfile: { height: 2, maxStepUp: 1, maxDrop: 1 },
  phases: [
    ...clearPhaseIds.map((id, index) => ({ id, dependsOn: index ? [clearPhaseIds[index - 1]] : [] })),
    ...buildPhaseIds.map((id, index) => ({ id, dependsOn: index ? [buildPhaseIds[index - 1]] : [clearPhaseIds.at(-1)] })),
    { id: "bridges", dependsOn: [buildPhaseIds.at(-1)] },
  ],
  operations: designOperations,
  protectedClearance: [
    { name: "main-south-door-clear", from: { x: 775, y: 178, z: 330 }, to: { x: 785, y: 188, z: 334 } },
    { name: "main-north-door-clear", from: { x: 775, y: 178, z: 274 }, to: { x: 785, y: 188, z: 278 } },
    { name: "west-south-door-clear", from: { x: 645, y: 172, z: 324 }, to: { x: 655, y: 182, z: 328 } },
    { name: "east-south-door-clear", from: { x: 905, y: 172, z: 324 }, to: { x: 915, y: 182, z: 328 } },
  ],
  routeChecks: [
    {
      name: "south-court-to-three-halls",
      startSpace: "south-court",
      goalSpaces: ["main-hall-room", "west-hall-room", "east-hall-room"],
      start: { x: 780, y: 171, z: 355 },
      goals: [{ x: 780, y: 179, z: 320 }, { x: 650, y: 173, z: 300 }, { x: 910, y: 173, z: 300 }],
    },
    {
      name: "north-court-to-main-hall",
      startSpace: "north-court",
      goalSpaces: ["main-hall-room"],
      start: { x: 780, y: 171, z: 250 },
      goals: [{ x: 780, y: 179, z: 288 }],
    },
  ],
  dimensionChecks: [
    { name: "main-to-west-clear-gap", value: layoutChecks[0].gapX, min: 24 },
    { name: "main-to-east-clear-gap", value: layoutChecks[1].gapX, min: 24 },
    { name: "main-roof-to-body-ratio", numerator: 14, denominator: 20, min: 0.5, max: 1.0 },
  ],
  weatherChecks: [
    { name: "hall-weather-cover", points: [{ x: 780, y: 179, z: 304 }, { x: 650, y: 173, z: 300 }, { x: 910, y: 173, z: 300 }] },
  ],
  lightingChecks: [
    { name: "main-hall-lighting", from: { x: 728, y: 179, z: 278 }, to: { x: 832, y: 197, z: 330 }, minimumSources: 12, samplePoints: [{ x: 780, y: 179, z: 304 }], maxDistance: 24 },
    { name: "west-hall-lighting", from: { x: 633, y: 173, z: 276 }, to: { x: 667, y: 182, z: 324 }, minimumSources: 4, samplePoints: [{ x: 650, y: 173, z: 300 }], maxDistance: 22 },
    { name: "east-hall-lighting", from: { x: 893, y: 173, z: 276 }, to: { x: 927, y: 182, z: 324 }, minimumSources: 4, samplePoints: [{ x: 910, y: 173, z: 300 }], maxDistance: 22 },
  ],
  styleChecks: [
    { name: "main-south-ceremonial-entry", from: { x: 774, y: 170, z: 330 }, to: { x: 786, y: 190, z: 355 }, forbiddenBlocks: ["minecraft:cyan_stained_glass", "minecraft:sea_lantern"] },
    { name: "main-north-ceremonial-entry", from: { x: 774, y: 170, z: 245 }, to: { x: 786, y: 190, z: 278 }, forbiddenBlocks: ["minecraft:cyan_stained_glass", "minecraft:sea_lantern"] },
  ],
  symmetryChecks: [
    { name: "core-court-bilateral-symmetry", axis: "x", coordinate: 780, mode: "base", from: { x: 620, y: 168, z: 245 }, to: { x: 940, y: 240, z: 359 } },
  ],
  acceptance: {
    requiredViews: ["site-massing", "golden-water-five-bridges", "ordinary-player-main-approach", "main-hall-interior"],
    ordinaryTraversal: ["south-court-to-three-halls", "north-court-to-main-hall", "five-bridge-crossings"],
    actualScanRegions: ["three-hall-bounds", "four-door-clearances", "five-bridge-approaches"],
    recovery: { checkpointDirectory: "D:/AI WORK/006/output/courtyard-v2-existing", projectId: PROJECT_ID },
  },
  layoutChecks,
};
await writeFile(OUTPUT, `${JSON.stringify(design, null, 2)}\n`);

const config = JSON.parse(await readFile("D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8"));
const headers = { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" };
const apply = process.argv.includes("--apply");
const requested = process.argv.find((arg) => arg.startsWith("--phase="))?.split("=")[1] ?? "all";
const selected = requested === "all" ? ["clear", "build", "bridges"] : [requested];

async function call(path, body) {
  const response = await fetch(`http://127.0.0.1:${config.port}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${result.error}`);
  return result;
}

const results = [];
await call("/v1/camera/begin", { spectator: true });
try {
  for (const phase of selected) {
    const parts = phase === "clear" ? phases.clear.map((op) => [op]) : batches(phases[phase]);
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      const bounds = part.reduce((b, op) => ({
        from: { x: Math.min(b.from.x, op.from.x), y: Math.min(b.from.y, op.from.y), z: Math.min(b.from.z, op.from.z) },
        to: { x: Math.max(b.to.x, op.to.x), y: Math.max(b.to.y, op.to.y), z: Math.max(b.to.z, op.to.z) },
      }), { from: { x: Infinity, y: Infinity, z: Infinity }, to: { x: -Infinity, y: -Infinity, z: -Infinity } });
      await call("/v1/camera/move", { position: { x: (bounds.from.x + bounds.to.x) / 2, y: 255, z: (bounds.from.z + bounds.to.z) / 2 }, pitch: 90 });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const result = await call("/v1/apply", {
        operations: part, label: `Forbidden City courtyard v2 ${phase} ${index + 1}/${parts.length}`,
        projectId: PROJECT_ID, dryRun: !apply,
      });
      results.push({ phase, part: index + 1, parts: parts.length, operationCount: part.length, result });
      if (!apply && !result.canApply) throw new Error(`${phase} ${index + 1} cannot apply`);
    }
  }
} finally {
  await call("/v1/camera/restore", {});
}

console.log(JSON.stringify({ apply, requested, manifest: OUTPUT, layoutChecks, results }, null, 2));
