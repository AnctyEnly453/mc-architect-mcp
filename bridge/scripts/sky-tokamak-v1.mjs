import { mkdir, readFile, writeFile } from "node:fs/promises";

const PROJECT_ID = "sky-tokamak-1280-326-v1";
const OUTPUT = "D:/AI WORK/006/output/sky-tokamak-v1-manifest.json";
const CX = 1280, CY = 212, CZ = 326;
const phases = { foundation: [], reactor: [], magnets: [], core: [], detail: [] };

const add = (phase, block, x1, y1, z1, x2, y2, z2) => phases[phase].push({
  block,
  from: { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2) },
  to: { x: Math.max(x1, x2), y: Math.max(y1, y2), z: Math.max(z1, z2) },
});
const volume = (op) => (op.to.x - op.from.x + 1) * (op.to.y - op.from.y + 1) * (op.to.z - op.from.z + 1);
const key = (x, y, z) => `${x},${y},${z}`;
const put = (map, block, x, y, z) => map.set(key(x, y, z), block);

function fillBox(map, block, x1, y1, z1, x2, y2, z2) {
  for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) put(map, block, x, y, z);
}

function lineXZ(map, block, x1, z1, x2, z2, y1, y2, radius = 1) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1));
  for (let i = 0; i <= steps; i++) {
    const t = steps ? i / steps : 0;
    const x = Math.round(x1 + (x2 - x1) * t), z = Math.round(z1 + (z2 - z1) * t);
    fillBox(map, block, x - radius, y1, z - radius, x + radius, y2, z + radius);
  }
}

function compress(map) {
  const rows = new Map();
  for (const [position, block] of map) {
    const [x, y, z] = position.split(",").map(Number);
    const rowKey = `${block}\u0000${y}\u0000${z}`;
    if (!rows.has(rowKey)) rows.set(rowKey, []);
    rows.get(rowKey).push(x);
  }

  const runs = [];
  for (const [rowKey, xs] of rows) {
    const [block, yText, zText] = rowKey.split("\u0000");
    xs.sort((a, b) => a - b);
    let x1 = xs[0], previous = xs[0];
    for (let i = 1; i <= xs.length; i++) {
      const x = xs[i];
      if (x === previous + 1) { previous = x; continue; }
      runs.push({ block, y: Number(yText), z: Number(zText), x1, x2: previous });
      x1 = x; previous = x;
    }
  }

  const byYAndSpan = new Map();
  for (const run of runs) {
    const k = `${run.block}\u0000${run.y}\u0000${run.x1}\u0000${run.x2}`;
    if (!byYAndSpan.has(k)) byYAndSpan.set(k, []);
    byYAndSpan.get(k).push(run.z);
  }
  const rectangles = [];
  for (const [spanKey, zs] of byYAndSpan) {
    const [block, yText, x1Text, x2Text] = spanKey.split("\u0000");
    zs.sort((a, b) => a - b);
    let z1 = zs[0], previous = zs[0];
    for (let i = 1; i <= zs.length; i++) {
      const z = zs[i];
      if (z === previous + 1) { previous = z; continue; }
      rectangles.push({ block, y1: Number(yText), y2: Number(yText), x1: Number(x1Text), x2: Number(x2Text), z1, z2: previous });
      z1 = z; previous = z;
    }
  }

  const byRectangle = new Map();
  for (const rect of rectangles) {
    const k = `${rect.block}\u0000${rect.x1}\u0000${rect.x2}\u0000${rect.z1}\u0000${rect.z2}`;
    if (!byRectangle.has(k)) byRectangle.set(k, []);
    byRectangle.get(k).push(rect.y1);
  }
  const cuboids = [];
  for (const [rectKey, ys] of byRectangle) {
    const [block, x1Text, x2Text, z1Text, z2Text] = rectKey.split("\u0000");
    ys.sort((a, b) => a - b);
    let y1 = ys[0], previous = ys[0];
    for (let i = 1; i <= ys.length; i++) {
      const y = ys[i];
      if (y === previous + 1) { previous = y; continue; }
      cuboids.push({ block, from: { x: Number(x1Text), y: y1, z: Number(z1Text) }, to: { x: Number(x2Text), y: previous, z: Number(z2Text) } });
      y1 = y; previous = y;
    }
  }
  return cuboids;
}

// Floating annular service platform, central island, axial access spokes, and open rail gates.
const foundation = new Map();
for (let z = CZ - 92; z <= CZ + 92; z++) for (let x = CX - 92; x <= CX + 92; x++) {
  const dx = x - CX, dz = z - CZ, r = Math.hypot(dx, dz);
  const spoke = Math.abs(dx) <= 3 || Math.abs(dz) <= 3;
  const deck = (r >= 38 && r <= 92) || r <= 34 || (spoke && r <= 92);
  if (!deck) continue;
  for (let y = 184; y <= 186; y++) put(foundation, "minecraft:deepslate_tiles", x, y, z);
  put(foundation, "minecraft:smooth_stone", x, 187, z);
  const atRail = r >= 90.5 && r <= 92;
  const cardinalGate = (Math.abs(dx) <= 4 || Math.abs(dz) <= 4);
  if (atRail && !cardinalGate) for (let y = 188; y <= 190; y++) put(foundation, "minecraft:iron_bars", x, y, z);
}
phases.foundation.push(...compress(foundation));

// Hollow white vacuum vessel with a transparent equatorial inspection band and luminous plasma core.
const reactor = new Map();
for (let y = CY - 15; y <= CY + 15; y++) for (let z = CZ - 75; z <= CZ + 75; z++) for (let x = CX - 75; x <= CX + 75; x++) {
  const radial = Math.hypot(x - CX, z - CZ);
  const tube = Math.hypot(radial - 60, y - CY);
  if (tube >= 11 && tube <= 15) {
    const block = Math.abs(y - CY) <= 2 ? "minecraft:cyan_stained_glass" : "minecraft:smooth_quartz";
    put(reactor, block, x, y, z);
  } else if (tube <= 4) {
    put(reactor, tube <= 2 ? "minecraft:sea_lantern" : "minecraft:cyan_stained_glass", x, y, z);
  }
}
phases.reactor.push(...compress(reactor));

// Sixteen toroidal-field magnet frames wrap the vessel in vertical radial planes.
const magnets = new Map();
const stations = [];
for (let i = 0; i < 16; i++) {
  const angle = (Math.PI * 2 * i) / 16;
  const ux = Math.cos(angle), uz = Math.sin(angle);
  const inner = { x: Math.round(CX + ux * 43), z: Math.round(CZ + uz * 43) };
  const outer = { x: Math.round(CX + ux * 77), z: Math.round(CZ + uz * 77) };
  stations.push({ angle, inner, outer });
  fillBox(magnets, "minecraft:waxed_copper_block", inner.x - 2, 194, inner.z - 2, inner.x + 2, 230, inner.z + 2);
  fillBox(magnets, "minecraft:waxed_copper_block", outer.x - 2, 194, outer.z - 2, outer.x + 2, 230, outer.z + 2);
  lineXZ(magnets, "minecraft:waxed_copper_block", inner.x, inner.z, outer.x, outer.z, 192, 195, 2);
  lineXZ(magnets, "minecraft:waxed_copper_block", inner.x, inner.z, outer.x, outer.z, 229, 232, 2);
}
phases.magnets.push(...compress(magnets));

// Central solenoid and four massive radial support arms.
const core = new Map();
for (let y = 188; y <= 252; y++) for (let z = CZ - 12; z <= CZ + 12; z++) for (let x = CX - 12; x <= CX + 12; x++) {
  const r = Math.hypot(x - CX, z - CZ);
  if (r <= 5) put(core, "minecraft:sea_lantern", x, y, z);
  else if (r >= 9 && r <= 12) {
    const block = ((y - 188) % 9 <= 1) ? "minecraft:polished_blackstone_bricks" : "minecraft:cut_copper";
    put(core, block, x, y, z);
  }
  if ((y <= 190 || y >= 250) && r <= 12) put(core, "minecraft:waxed_copper_block", x, y, z);
}
for (const y1 of [204, 216]) {
  lineXZ(core, "minecraft:iron_block", CX + 13, CZ, CX + 45, CZ, y1, y1 + 3, 1);
  lineXZ(core, "minecraft:iron_block", CX - 13, CZ, CX - 45, CZ, y1, y1 + 3, 1);
  lineXZ(core, "minecraft:iron_block", CX, CZ + 13, CX, CZ + 45, y1, y1 + 3, 1);
  lineXZ(core, "minecraft:iron_block", CX, CZ - 13, CX, CZ - 45, y1, y1 + 3, 1);
}
phases.core.push(...compress(core));

// Hazard ring, coil clamps, platform lights, and a high outer maintenance catwalk.
const detail = new Map();
for (let z = CZ - 83; z <= CZ + 83; z++) for (let x = CX - 83; x <= CX + 83; x++) {
  const dx = x - CX, dz = z - CZ, r = Math.hypot(dx, dz);
  if (r >= 78 && r <= 82) {
    const sector = Math.floor(Math.atan2(Math.abs(dz), Math.abs(dx)) / (Math.PI / 24));
    put(detail, sector % 2 ? "minecraft:yellow_concrete" : "minecraft:black_concrete", x, 187, z);
  }
  if (r >= 82 && r <= 86) for (let y = 233; y <= 234; y++) put(detail, "minecraft:polished_blackstone_bricks", x, y, z);
}
for (const station of stations) {
  for (const point of [station.inner, station.outer]) {
    fillBox(detail, "minecraft:polished_blackstone_bricks", point.x - 2, 205, point.z - 2, point.x + 2, 207, point.z + 2);
    fillBox(detail, "minecraft:polished_blackstone_bricks", point.x - 2, 217, point.z - 2, point.x + 2, 219, point.z + 2);
  }
}
for (let i = 0; i < 24; i++) {
  const angle = (Math.PI * 2 * i) / 24;
  const x = Math.round(CX + Math.cos(angle) * 88), z = Math.round(CZ + Math.sin(angle) * 88);
  put(detail, "minecraft:sea_lantern", x, 187, z);
}
for (let distance = 32; distance <= 88; distance += 8) {
  put(detail, "minecraft:sea_lantern", CX + distance, 187, CZ);
  put(detail, "minecraft:sea_lantern", CX - distance, 187, CZ);
  put(detail, "minecraft:sea_lantern", CX, 187, CZ + distance);
  put(detail, "minecraft:sea_lantern", CX, 187, CZ - distance);
}
for (let z = CZ - 90; z <= CZ + 90; z += 10) for (let x = CX - 90; x <= CX + 90; x += 10) {
  const dx = x - CX, dz = z - CZ, r = Math.hypot(dx, dz);
  const spoke = Math.abs(dx) <= 3 || Math.abs(dz) <= 3;
  const aboveDeck = (r >= 38 && r <= 90) || r <= 34 || (spoke && r <= 90);
  if (aboveDeck) put(detail, "minecraft:light[level=15]", x, 189, z);
}
phases.detail.push(...compress(detail));

function batches(operations, maxGross = 180000, maxOps = 220) {
  const result = []; let current = [], gross = 0;
  for (const op of operations) {
    const size = volume(op);
    if (current.length && (current.length >= maxOps || gross + size > maxGross)) {
      result.push(current); current = []; gross = 0;
    }
    current.push(op); gross += size;
  }
  if (current.length) result.push(current);
  return result;
}

const phaseOrder = ["foundation", "reactor", "magnets", "core", "detail"];
const phaseDefinitions = [], designOperations = [];
let previous = null;
for (const phase of phaseOrder) {
  const parts = batches(phases[phase]);
  parts.forEach((part, index) => {
    const id = `${phase}-${index + 1}`;
    phaseDefinitions.push({ id, dependsOn: previous ? [previous] : [] });
    designOperations.push(...part.map((op) => ({ ...op, phase: id })));
    previous = id;
  });
}

const design = {
  name: "sky-tokamak-v1",
  project: { id: PROJECT_ID, scale: "complex", worldId: "current-singleplayer-save", dimension: "minecraft:overworld", revision: 1 },
  bounds: { from: { x: 1185, y: 180, z: 231 }, to: { x: 1375, y: 260, z: 421 } },
  site: {
    datumY: 187, north: "-z", mainAxis: "x",
    protectedRegions: [{ id: "player-observation-point", from: { x: 1378, y: 225, z: 323 }, to: { x: 1385, y: 232, z: 330 } }],
    existingScan: { mode: "summary", result: "100-percent-empty", scannedAt: "2026-07-12", bounds: { from: { x: 1185, y: 175, z: 231 }, to: { x: 1375, y: 265, z: 421 } } },
  },
  style: {
    name: "monumental-fusion-reactor",
    module: 4,
    palette: {
      foundation: ["minecraft:deepslate_tiles", "minecraft:smooth_stone"],
      vessel: ["minecraft:smooth_quartz", "minecraft:cyan_stained_glass"],
      magnet: ["minecraft:waxed_copper_block", "minecraft:polished_blackstone_bricks"],
      plasma: ["minecraft:sea_lantern", "minecraft:cyan_stained_glass"],
      structure: ["minecraft:iron_block", "minecraft:cut_copper"],
      safety: ["minecraft:yellow_concrete", "minecraft:black_concrete"],
    },
  },
  buildings: [{ id: "tokamak-reactor", zone: "sky-reactor-site", floors: ["service-deck", "reactor-ring", "upper-catwalk"] }],
  spaces: [
    { id: "east-access-pad", kind: "exterior", exterior: true },
    { id: "inner-service-deck", kind: "occupied", occupied: true, building: "tokamak-reactor", floor: "service-deck" },
  ],
  portals: [{ id: "east-service-route", kind: "open-passage", connects: ["east-access-pad", "inner-service-deck"], clearanceCheck: "east-service-route-full" }],
  defaultBlock: "minecraft:air",
  passableBlocks: ["minecraft:light"],
  movementProfile: { height: 2, maxStepUp: 1, maxDrop: 1 },
  phases: phaseDefinitions,
  operations: designOperations,
  protectedClearance: [{ name: "east-service-route-full", from: { x: 1310, y: 188, z: 324 }, to: { x: 1368, y: 189, z: 328 } }],
  routeChecks: [{
    name: "east-access-to-inner-service-deck", startSpace: "east-access-pad", goalSpaces: ["inner-service-deck"],
    start: { x: 1368, y: 188, z: 326 }, goals: [{ x: 1312, y: 188, z: 326 }],
  }],
  dimensionChecks: [
    { name: "overall-platform-diameter", value: 185, min: 180 },
    { name: "vacuum-vessel-outer-diameter", value: 150, min: 140 },
    { name: "central-solenoid-height", value: 65, min: 60 },
    { name: "toroidal-field-coil-count", value: 16, min: 12 },
  ],
  lightingChecks: [{
    name: "service-platform-guidance", from: { x: 1190, y: 184, z: 236 }, to: { x: 1370, y: 190, z: 416 },
    minimumSources: 16, samplePoints: [{ x: 1368, y: 188, z: 326 }, { x: 1312, y: 188, z: 326 }], maxDistance: 16,
  }],
  styleChecks: [{
    name: "industrial-material-language", from: { x: 1185, y: 184, z: 231 }, to: { x: 1375, y: 252, z: 421 },
    forbiddenBlocks: ["minecraft:oak_planks", "minecraft:cobblestone", "minecraft:red_terracotta"],
  }],
  symmetryChecks: [
    { name: "east-west-bilateral", axis: "x", coordinate: CX, mode: "base", from: { x: 1188, y: 184, z: 234 }, to: { x: 1372, y: 252, z: 418 } },
    { name: "north-south-bilateral", axis: "z", coordinate: CZ, mode: "base", from: { x: 1188, y: 184, z: 234 }, to: { x: 1372, y: 252, z: 418 } },
  ],
  acceptance: {
    requiredViews: ["player-west-facing-hero-view", "top-oblique-reactor-ring", "service-deck-and-central-solenoid"],
    ordinaryTraversal: ["east-access-to-inner-service-deck"],
    actualScanRegions: ["vacuum-vessel", "central-solenoid", "east-service-route"],
    recovery: { projectId: PROJECT_ID, preconstructionState: "scanned-empty-air-volume" },
  },
};

await mkdir("D:/AI WORK/006/output", { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(design, null, 2)}\n`);
const stats = Object.fromEntries(phaseOrder.map((phase) => [phase, { operations: phases[phase].length, grossBlocks: phases[phase].reduce((n, op) => n + volume(op), 0), parts: batches(phases[phase]).length }]));
if (process.argv.includes("--manifest-only")) {
  console.log(JSON.stringify({ projectId: PROJECT_ID, manifest: OUTPUT, stats }, null, 2));
  process.exit(0);
}

const config = JSON.parse(await readFile("D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8"));
const headers = { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" };
const apply = process.argv.includes("--apply");
const requested = process.argv.find((arg) => arg.startsWith("--phase="))?.split("=")[1] ?? "all";
const selected = requested === "all" ? phaseOrder : [requested];

async function call(path, body) {
  const response = await fetch(`http://127.0.0.1:${config.port}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${result.error ?? response.statusText}`);
  return result;
}

const results = [];
await call("/v1/camera/begin", { spectator: true });
try {
  for (const phase of selected) {
    const parts = batches(phases[phase]);
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      await call("/v1/camera/move", { position: { x: CX, y: 270, z: CZ }, pitch: 90, yaw: 0 });
      await new Promise((resolve) => setTimeout(resolve, 200));
      const result = await call("/v1/apply", {
        operations: part, dryRun: !apply, projectId: PROJECT_ID,
        label: `Sky tokamak v1 ${phase} ${index + 1}/${parts.length}`,
      });
      if (!apply && !result.canApply) throw new Error(`${phase} ${index + 1} cannot apply`);
      results.push({ phase, part: index + 1, parts: parts.length, operationCount: part.length, result });
    }
  }
} finally {
  await call("/v1/camera/restore", {});
}

console.log(JSON.stringify({ apply, requested, projectId: PROJECT_ID, manifest: OUTPUT, stats, results }, null, 2));
