import { mkdir, readFile, writeFile } from "node:fs/promises";

const PROJECT_ID = "sky-research-port-1280-326-v1";
const OUTPUT = "D:/AI WORK/006/output/sky-research-port-v1-manifest.json";
const CX = 1280, CZ = 326;
const phases = { ring: [], arms: [], modules: [], superstructure: [], alignment: [], interiors: [], pod_retrofit: [], energy: [], detail: [] };
const phaseOrder = Object.keys(phases);

const volume = (op) => (op.to.x - op.from.x + 1) * (op.to.y - op.from.y + 1) * (op.to.z - op.from.z + 1);
const key = (x, y, z) => `${x},${y},${z}`;
const put = (map, block, x, y, z) => map.set(key(x, y, z), block);
const del = (map, x, y, z) => map.delete(key(x, y, z));

function fillBox(map, block, x1, y1, z1, x2, y2, z2) {
  for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) put(map, block, x, y, z);
}

function clearBox(map, x1, y1, z1, x2, y2, z2) {
  for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) del(map, x, y, z);
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
    const k = `${block}\u0000${y}\u0000${z}`;
    if (!rows.has(k)) rows.set(k, []);
    rows.get(k).push(x);
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
  const bySpan = new Map();
  for (const run of runs) {
    const k = `${run.block}\u0000${run.y}\u0000${run.x1}\u0000${run.x2}`;
    if (!bySpan.has(k)) bySpan.set(k, []);
    bySpan.get(k).push(run.z);
  }
  const rects = [];
  for (const [spanKey, zs] of bySpan) {
    const [block, yText, x1Text, x2Text] = spanKey.split("\u0000");
    zs.sort((a, b) => a - b);
    let z1 = zs[0], previous = zs[0];
    for (let i = 1; i <= zs.length; i++) {
      const z = zs[i];
      if (z === previous + 1) { previous = z; continue; }
      rects.push({ block, y: Number(yText), x1: Number(x1Text), x2: Number(x2Text), z1, z2: previous });
      z1 = z; previous = z;
    }
  }
  const byRect = new Map();
  for (const rect of rects) {
    const k = `${rect.block}\u0000${rect.x1}\u0000${rect.x2}\u0000${rect.z1}\u0000${rect.z2}`;
    if (!byRect.has(k)) byRect.set(k, []);
    byRect.get(k).push(rect.y);
  }
  const cuboids = [];
  for (const [rectKey, ys] of byRect) {
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

// A 411-block-diameter lower orbital ring. The central tokamak remains untouched inside radius 92.
const ring = new Map();
for (let z = CZ - 205; z <= CZ + 205; z++) for (let x = CX - 205; x <= CX + 205; x++) {
  const dx = x - CX, dz = z - CZ, r = Math.hypot(dx, dz);
  if (r < 175 || r > 205) continue;
  for (let y = 182; y <= 185; y++) put(ring, "minecraft:deepslate_tiles", x, y, z);
  put(ring, "minecraft:iron_block", x, 186, z);
  put(ring, "minecraft:smooth_stone", x, 187, z);
  const cardinalGap = Math.abs(dx) <= 7 || Math.abs(dz) <= 7;
  if (!cardinalGap && ((r >= 175 && r <= 176.5) || (r >= 203.5 && r <= 205))) {
    for (let y = 188; y <= 190; y++) put(ring, "minecraft:iron_bars", x, y, z);
  }
}
phases.ring.push(...compress(ring));

// Four diagonal bridges preserve the original east-facing hero view of the tokamak.
const arms = new Map();
const diagonalAngles = [45, 135, 225, 315];
for (const degrees of diagonalAngles) {
  const angle = degrees * Math.PI / 180, ux = Math.cos(angle), uz = Math.sin(angle);
  const inner = { x: Math.round(CX + ux * 92), z: Math.round(CZ + uz * 92) };
  const outer = { x: Math.round(CX + ux * 180), z: Math.round(CZ + uz * 180) };
  lineXZ(arms, "minecraft:deepslate_tiles", inner.x, inner.z, outer.x, outer.z, 183, 185, 6);
  lineXZ(arms, "minecraft:iron_block", inner.x, inner.z, outer.x, outer.z, 186, 186, 6);
  lineXZ(arms, "minecraft:smooth_stone", inner.x, inner.z, outer.x, outer.z, 187, 187, 6);
  const vx = -uz, vz = ux;
  for (let distance = 108; distance <= 168; distance += 20) {
    const px = Math.round(CX + ux * distance), pz = Math.round(CZ + uz * distance);
    const a = { x: Math.round(px + vx * 6), z: Math.round(pz + vz * 6) };
    const b = { x: Math.round(px - vx * 6), z: Math.round(pz - vz * 6) };
    lineXZ(arms, "minecraft:waxed_copper_block", a.x, a.z, b.x, b.z, 180, 182, 1);
  }
}
phases.arms.push(...compress(arms));
const armClearances = new Map();
for (const degrees of diagonalAngles) {
  const angle = degrees * Math.PI / 180, ux = Math.cos(angle), uz = Math.sin(angle);
  const inner = { x: Math.round(CX + ux * 168), z: Math.round(CZ + uz * 168) };
  const outer = { x: Math.round(CX + ux * 185), z: Math.round(CZ + uz * 185) };
  lineXZ(armClearances, "minecraft:air", inner.x, inner.z, outer.x, outer.z, 188, 193, 6);
}
phases.arms.push(...compress(armClearances));

// Four cardinal research pods are hollow, glazed, and keep a full six-block-high ring corridor.
// The legacy radius-204 footprints are retained only for the in-world retrofit cleanup.
const legacyPods = [
  { id: "east-lab", axis: "z", cx: CX + 204, cz: CZ, x1: CX + 192, x2: CX + 216, z1: CZ - 22, z2: CZ + 22, outer: "east" },
  { id: "west-lab", axis: "z", cx: CX - 204, cz: CZ, x1: CX - 216, x2: CX - 192, z1: CZ - 22, z2: CZ + 22, outer: "west" },
  { id: "north-lab", axis: "x", cx: CX, cz: CZ - 204, x1: CX - 22, x2: CX + 22, z1: CZ - 216, z2: CZ - 192, outer: "north" },
  { id: "south-lab", axis: "x", cx: CX, cz: CZ + 204, x1: CX - 22, x2: CX + 22, z1: CZ + 192, z2: CZ + 216, outer: "south" },
];
const pods = [
  { id: "east-lab", axis: "z", cx: CX + 198, cz: CZ, x1: CX + 186, x2: CX + 210, z1: CZ - 22, z2: CZ + 22, outer: "east" },
  { id: "west-lab", axis: "z", cx: CX - 198, cz: CZ, x1: CX - 210, x2: CX - 186, z1: CZ - 22, z2: CZ + 22, outer: "west" },
  { id: "north-lab", axis: "x", cx: CX, cz: CZ - 198, x1: CX - 22, x2: CX + 22, z1: CZ - 210, z2: CZ - 186, outer: "north" },
  { id: "south-lab", axis: "x", cx: CX, cz: CZ + 198, x1: CX - 22, x2: CX + 22, z1: CZ + 186, z2: CZ + 210, outer: "south" },
];
const podOuterSign = (pod) => (pod.outer === "east" || pod.outer === "south" ? 1 : -1);
const podHalfWidth = (t) => {
  const a = Math.abs(t);
  if (a <= 16) return 12;
  if (a <= 18) return 11;
  if (a <= 20) return 10;
  return 9;
};
const podWorld = (pod, n, t) => pod.axis === "z"
  ? { x: pod.cx + n, z: pod.cz + t }
  : { x: pod.cx + t, z: pod.cz + n };
const fillPodLocal = (map, pod, block, n1, y1, t1, n2, y2, t2) => {
  const a = podWorld(pod, n1, t1), b = podWorld(pod, n2, t2);
  fillBox(map, block, Math.min(a.x, b.x), y1, Math.min(a.z, b.z), Math.max(a.x, b.x), y2, Math.max(a.z, b.z));
};
function buildPodModule(map, pod) {
  const outerSign = podOuterSign(pod);
  for (let t = -22; t <= 22; t++) {
    const half = podHalfWidth(t);
    for (let n = -half; n <= half; n++) {
      const { x, z } = podWorld(pod, n, t);
      for (let y = 182; y <= 185; y++) put(map, "minecraft:deepslate_tiles", x, y, z);
      put(map, "minecraft:iron_block", x, 186, z);
      put(map, "minecraft:smooth_stone", x, 187, z);
      const boundary = Math.abs(n) === half || Math.abs(t) === 22;
      if (boundary) for (let y = 188; y <= 217; y++) put(map, "minecraft:smooth_quartz", x, y, z);
      if (n === outerSign * half && Math.abs(t) <= 15) {
        for (let y = 198; y <= 209; y++) put(map, "minecraft:cyan_stained_glass", x, y, z);
      }
      for (let y = 218; y <= 221; y++) put(map, "minecraft:polished_blackstone_bricks", x, y, z);
    }
  }
  for (let t = -22; t <= 22; t++) for (let n = -5; n <= 5; n++) {
    const { x, z } = podWorld(pod, n, t);
    for (let y = 188; y <= 193; y++) put(map, "minecraft:air", x, y, z);
  }
}
const alignedPodCenter = (pod) => {
  if (pod.outer === "east") return { x: CX + 197, z: CZ };
  if (pod.outer === "west") return { x: CX - 197, z: CZ };
  if (pod.outer === "north") return { x: CX, z: CZ - 197 };
  return { x: CX, z: CZ + 197 };
};
const modules = new Map();
for (const pod of pods) buildPodModule(modules, pod);
phases.modules.push(...compress(modules));
for (const pod of pods) {
  if (pod.axis === "z") phases.modules.push({
    block: "minecraft:air",
    from: { x: pod.cx - 5, y: 188, z: pod.z1 }, to: { x: pod.cx + 5, y: 193, z: pod.z2 },
  });
  else phases.modules.push({
    block: "minecraft:air",
    from: { x: pod.x1, y: 188, z: pod.cz - 5 }, to: { x: pod.x2, y: 193, z: pod.cz + 5 },
  });
}

// An upper halo, eight twin-pylon stations, four diagonal docking gates, and pod antenna spires.
const superstructure = new Map();
for (let z = CZ - 205; z <= CZ + 205; z++) for (let x = CX - 205; x <= CX + 205; x++) {
  const r = Math.hypot(x - CX, z - CZ);
  if (r >= 185 && r <= 205) {
    for (let y = 238; y <= 241; y++) put(superstructure, "minecraft:polished_blackstone_bricks", x, y, z);
    if (r >= 193 && r <= 197) put(superstructure, "minecraft:cyan_stained_glass", x, 237, z);
  }
}
// Diagonal station pairs support the halo; cardinal pairs are omitted because
// the integrated laboratory towers carry those four sectors.
for (let i = 1; i < 8; i += 2) {
  const angle = Math.PI * 2 * i / 8, ux = Math.cos(angle), uz = Math.sin(angle), vx = -uz, vz = ux;
  for (const side of [-11, 11]) {
    const x = Math.round(CX + ux * 194 + vx * side), z = Math.round(CZ + uz * 194 + vz * side);
    fillBox(superstructure, "minecraft:polished_blackstone_bricks", x - 2, 188, z - 2, x + 2, 237, z + 2);
    fillBox(superstructure, "minecraft:cyan_stained_glass", x - 1, 202, z - 1, x + 1, 226, z + 1);
  }
}
for (const degrees of diagonalAngles) {
  const angle = degrees * Math.PI / 180, ux = Math.cos(angle), uz = Math.sin(angle), vx = -uz, vz = ux;
  const center = { x: Math.round(CX + ux * 212), z: Math.round(CZ + uz * 212) };
  const a = { x: Math.round(center.x + vx * 12), z: Math.round(center.z + vz * 12) };
  const b = { x: Math.round(center.x - vx * 12), z: Math.round(center.z - vz * 12) };
  fillBox(superstructure, "minecraft:waxed_copper_block", a.x - 2, 188, a.z - 2, a.x + 2, 225, a.z + 2);
  fillBox(superstructure, "minecraft:waxed_copper_block", b.x - 2, 188, b.z - 2, b.x + 2, 225, b.z + 2);
  lineXZ(superstructure, "minecraft:waxed_copper_block", a.x, a.z, b.x, b.z, 222, 226, 2);
}
for (const pod of pods) {
  const center = alignedPodCenter(pod);
  fillBox(superstructure, "minecraft:polished_blackstone_bricks", center.x - 5, 222, center.z - 5, center.x + 5, 252, center.z + 5);
  fillBox(superstructure, "minecraft:cyan_stained_glass", center.x - 3, 226, center.z - 3, center.x + 3, 248, center.z + 3);
  fillBox(superstructure, "minecraft:sea_lantern", center.x - 1, 253, center.z - 1, center.x + 1, 255, center.z + 1);
}
phases.superstructure.push(...compress(superstructure));

// Cardinal pod towers originally followed the pod facade radius (204), while the
// upper halo is centered near radius 195. Re-center the towers on the halo load
// path and restore the halo cells exposed by removing the old off-axis towers.
const alignment = new Map();
for (let index = 0; index < pods.length; index++) {
  const pod = pods[index], legacy = legacyPods[index];
  fillBox(alignment, "minecraft:air", legacy.cx - 5, 222, legacy.cz - 5, legacy.cx + 5, 255, legacy.cz + 5);
  for (let z = legacy.cz - 5; z <= legacy.cz + 5; z++) for (let x = legacy.cx - 5; x <= legacy.cx + 5; x++) {
    const r = Math.hypot(x - CX, z - CZ);
    if (r >= 185 && r <= 205) for (let y = 238; y <= 241; y++) put(alignment, "minecraft:polished_blackstone_bricks", x, y, z);
    if (r >= 193 && r <= 197) put(alignment, "minecraft:cyan_stained_glass", x, 237, z);
  }
  const center = alignedPodCenter(pod);
  fillBox(alignment, "minecraft:polished_blackstone_bricks", center.x - 5, 222, center.z - 5, center.x + 5, 252, center.z + 5);
  fillBox(alignment, "minecraft:cyan_stained_glass", center.x - 3, 226, center.z - 3, center.x + 3, 248, center.z + 3);
  fillBox(alignment, "minecraft:sea_lantern", center.x - 1, 253, center.z - 1, center.x + 1, 255, center.z + 1);
}
phases.alignment.push(...compress(alignment));

// Usable ring-level laboratories: keep the full 11-wide by 6-high route clear,
// while equipment, lighting, and portal frames occupy only the side bays.
function buildPodInterior(map, pod) {
  const localBox = (block, n1, y1, t1, n2, y2, t2) => fillPodLocal(map, pod, block, n1, y1, t1, n2, y2, t2);
  // Cyan centerline and paired edge lights are embedded in the existing floor.
  localBox("minecraft:cyan_concrete", 0, 187, -20, 0, 187, 20);
  for (const t of [-18, -12, -6, 0, 6, 12, 18]) {
    localBox("minecraft:sea_lantern", -5, 187, t, -5, 187, t);
    localBox("minecraft:sea_lantern", 5, 187, t, 5, 187, t);
  }

  // Six symmetric containment/workstation assemblies, all outside |n| <= 5.
  for (const n of [-8, 8]) for (const t of [-14, 0, 14]) {
    localBox("minecraft:polished_blackstone_bricks", n - 1, 188, t - 2, n + 1, 189, t + 2);
    for (const dn of [-1, 1]) for (const dt of [-2, 2]) {
      localBox("minecraft:waxed_copper_block", n + dn, 190, t + dt, n + dn, 205, t + dt);
    }
    localBox("minecraft:cyan_stained_glass", n, 190, t - 1, n, 204, t + 1);
    localBox("minecraft:sea_lantern", n - 1, 206, t - 2, n + 1, 206, t + 2);
  }

  // Portal frames preserve the six-block route clearance; ceiling panels sit well above it.
  for (const t of [-21, 21]) {
    localBox("minecraft:waxed_copper_block", -6, 188, t, -6, 194, t);
    localBox("minecraft:waxed_copper_block", 6, 188, t, 6, 194, t);
    localBox("minecraft:waxed_copper_block", -6, 194, t, 6, 194, t);
  }
  for (const t of [-16, -8, 0, 8, 16]) {
    localBox("minecraft:sea_lantern", -2, 216, t - 1, 2, 216, t + 1);
  }
}
const interiors = new Map();
for (const pod of pods) buildPodInterior(interiors, pod);
phases.interiors.push(...compress(interiors));

// Retrofit the already-built radius-204 pods: remove their old envelopes and
// the four cardinal pylon pairs, restore the exposed ring, then build the
// inward-shifted chamfered pods and interiors as the final composite state.
const podRetrofit = new Map();
for (const legacy of legacyPods) fillBox(podRetrofit, "minecraft:air", legacy.x1, 182, legacy.z1, legacy.x2, 221, legacy.z2);

const removedCardinalPylons = [];
for (const i of [0, 2, 4, 6]) {
  const angle = Math.PI * 2 * i / 8, ux = Math.cos(angle), uz = Math.sin(angle), vx = -uz, vz = ux;
  for (const side of [-11, 11]) {
    const x = Math.round(CX + ux * 194 + vx * side), z = Math.round(CZ + uz * 194 + vz * side);
    removedCardinalPylons.push({ x, z });
    fillBox(podRetrofit, "minecraft:air", x - 2, 188, z - 2, x + 2, 237, z + 2);
  }
}

const guidanceLights = new Set();
for (let i = 0; i < 48; i++) {
  const angle = Math.PI * 2 * i / 48;
  guidanceLights.add(key(Math.round(CX + Math.cos(angle) * 200), 187, Math.round(CZ + Math.sin(angle) * 200)));
}
for (const legacy of legacyPods) for (let z = legacy.z1; z <= legacy.z2; z++) for (let x = legacy.x1; x <= legacy.x2; x++) {
  const dx = x - CX, dz = z - CZ, r = Math.hypot(dx, dz);
  if (r < 175 || r > 205) continue;
  for (let y = 182; y <= 185; y++) put(podRetrofit, "minecraft:deepslate_tiles", x, y, z);
  put(podRetrofit, "minecraft:iron_block", x, 186, z);
  let floorBlock = "minecraft:smooth_stone";
  if (r >= 181 && r <= 184) {
    const sector = Math.floor(Math.atan2(Math.abs(dz), Math.abs(dx)) / (Math.PI / 24));
    floorBlock = sector % 2 ? "minecraft:yellow_concrete" : "minecraft:black_concrete";
  }
  if (guidanceLights.has(key(x, 187, z))) floorBlock = "minecraft:sea_lantern";
  put(podRetrofit, floorBlock, x, 187, z);
  const cardinalGap = Math.abs(dx) <= 7 || Math.abs(dz) <= 7;
  if (!cardinalGap && ((r >= 175 && r <= 176.5) || (r >= 203.5 && r <= 205))) {
    for (let y = 188; y <= 190; y++) put(podRetrofit, "minecraft:iron_bars", x, y, z);
  }
}
for (const pylon of removedCardinalPylons) for (let z = pylon.z - 2; z <= pylon.z + 2; z++) for (let x = pylon.x - 2; x <= pylon.x + 2; x++) {
  const r = Math.hypot(x - CX, z - CZ);
  if (r >= 193 && r <= 197) put(podRetrofit, "minecraft:cyan_stained_glass", x, 237, z);
}
for (const pod of pods) {
  buildPodModule(podRetrofit, pod);
  buildPodInterior(podRetrofit, pod);
}
phases.pod_retrofit.push(...compress(podRetrofit));

// Reactor energy column above the existing central solenoid; it does not touch the tokamak below Y=253.
const energy = new Map();
for (let y = 253; y <= 318; y++) for (let z = CZ - 6; z <= CZ + 6; z++) for (let x = CX - 6; x <= CX + 6; x++) {
  const r = Math.hypot(x - CX, z - CZ);
  if (r <= 2) put(energy, "minecraft:sea_lantern", x, y, z);
  else if (r >= 4 && r <= 6) put(energy, "minecraft:cyan_stained_glass", x, y, z);
}
for (let z = CZ - 13; z <= CZ + 13; z++) for (let x = CX - 13; x <= CX + 13; x++) {
  const r = Math.hypot(x - CX, z - CZ);
  if (r >= 10 && r <= 13) for (let y = 292; y <= 295; y++) put(energy, "minecraft:iron_block", x, y, z);
}
phases.energy.push(...compress(energy));

// Symmetric hazard bands and guidance lights. Spawn-proofing is intentionally out of scope by user request.
const detail = new Map();
for (let z = CZ - 205; z <= CZ + 205; z++) for (let x = CX - 205; x <= CX + 205; x++) {
  const dx = x - CX, dz = z - CZ, r = Math.hypot(dx, dz);
  if (r >= 181 && r <= 184) {
    const sector = Math.floor(Math.atan2(Math.abs(dz), Math.abs(dx)) / (Math.PI / 24));
    put(detail, sector % 2 ? "minecraft:yellow_concrete" : "minecraft:black_concrete", x, 187, z);
  }
}
for (let i = 0; i < 48; i++) {
  const angle = Math.PI * 2 * i / 48;
  const x = Math.round(CX + Math.cos(angle) * 200), z = Math.round(CZ + Math.sin(angle) * 200);
  put(detail, "minecraft:sea_lantern", x, 187, z);
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

const phaseDefinitions = [], designOperations = [];
let previous = null;
for (const phase of phaseOrder) {
  batches(phases[phase]).forEach((part, index) => {
    const id = `${phase}-${index + 1}`;
    phaseDefinitions.push({ id, dependsOn: previous ? [previous] : [] });
    designOperations.push(...part.map((op) => ({ ...op, phase: id })));
    previous = id;
  });
}

const corridorChecks = pods.map((pod) => pod.axis === "z" ? {
  name: `${pod.id}-corridor`, from: { x: pod.cx - 5, y: 188, z: pod.z1 }, to: { x: pod.cx + 5, y: 193, z: pod.z2 },
} : {
  name: `${pod.id}-corridor`, from: { x: pod.x1, y: 188, z: pod.cz - 5 }, to: { x: pod.x2, y: 193, z: pod.cz + 5 },
});

const design = {
  name: "sky-research-port-v1",
  project: { id: PROJECT_ID, scale: "complex", worldId: "current-singleplayer-save", dimension: "minecraft:overworld", revision: 2 },
  bounds: { from: { x: 1060, y: 180, z: 106 }, to: { x: 1500, y: 318, z: 546 } },
  site: {
    datumY: 187, north: "-z", mainAxis: "diagonal",
    protectedRegions: [
      { id: "retained-tokamak-central-solenoid", from: { x: 1267, y: 184, z: 313 }, to: { x: 1293, y: 252, z: 339 } },
      { id: "forbidden-city-separation", from: { x: 900, y: 150, z: 110 }, to: { x: 1059, y: 280, z: 542 } },
    ],
    sitingEvidence: { outerSectors: "100-percent-empty", westernArtificialBoundaryMaxX: 1059, projectMinimumX: 1060 },
  },
  style: {
    name: "orbital-fusion-research-port",
    module: 5,
    palette: {
      deck: ["minecraft:deepslate_tiles", "minecraft:iron_block", "minecraft:smooth_stone"],
      frame: ["minecraft:polished_blackstone_bricks", "minecraft:waxed_copper_block"],
      envelope: ["minecraft:smooth_quartz", "minecraft:cyan_stained_glass"],
      energy: ["minecraft:sea_lantern", "minecraft:cyan_stained_glass"],
      safety: ["minecraft:yellow_concrete", "minecraft:black_concrete"],
    },
  },
  buildings: [
    { id: "orbital-ring", zone: "research-port", floors: ["lower-ring", "upper-halo"] },
    ...pods.map((pod) => ({ id: pod.id, zone: "research-port", floors: ["ring-level"] })),
  ],
  spaces: [
    { id: "tokamak-interface", kind: "exterior", exterior: true },
    { id: "orbital-ring-route", kind: "occupied", occupied: true, building: "orbital-ring", floor: "lower-ring" },
    ...pods.map((pod) => ({ id: `${pod.id}-corridor-space`, kind: "occupied", occupied: true, building: pod.id, floor: "ring-level" })),
  ],
  portals: [
    { id: "ne-arm-interface", kind: "open-passage", connects: ["tokamak-interface", "orbital-ring-route"], clearanceCheck: "ne-arm-interface-full" },
    ...pods.map((pod) => ({ id: `${pod.id}-entry`, kind: "open-passage", connects: ["orbital-ring-route", `${pod.id}-corridor-space`], clearanceCheck: `${pod.id}-corridor` })),
  ],
  defaultBlock: "minecraft:air",
  passableBlocks: [],
  movementProfile: { height: 2, maxStepUp: 1, maxDrop: 1 },
  phases: phaseDefinitions,
  operations: designOperations,
  protectedClearance: [
    { name: "ne-arm-interface-full", from: { x: 1342, y: 188, z: 388 }, to: { x: 1348, y: 193, z: 394 } },
    ...corridorChecks,
  ],
  routeChecks: [{
    name: "tokamak-interface-to-ring-and-all-pods",
    startSpace: "tokamak-interface",
    goalSpaces: ["orbital-ring-route", ...pods.map((pod) => `${pod.id}-corridor-space`)],
    start: { x: 1345, y: 188, z: 392 },
    goals: [
      { x: 1407, y: 188, z: 453 },
      { x: 1478, y: 188, z: 326 }, { x: 1082, y: 188, z: 326 },
      { x: 1280, y: 188, z: 128 }, { x: 1280, y: 188, z: 524 },
    ],
  }],
  dimensionChecks: [
    { name: "overall-port-diameter", value: 441, min: 420 },
    { name: "lower-orbital-ring-diameter", value: 411, min: 400 },
    { name: "research-pod-count", value: 4, min: 4 },
    { name: "docking-gate-count", value: 4, min: 4 },
    { name: "energy-column-height", value: 66, min: 60 },
  ],
  styleChecks: [{
    name: "sci-fi-only-materials", from: { x: 1060, y: 182, z: 106 }, to: { x: 1500, y: 318, z: 546 },
    forbiddenBlocks: ["minecraft:oak_planks", "minecraft:cobblestone", "minecraft:red_terracotta"],
  }],
  symmetryChecks: [
    { name: "lower-ring-east-west", axis: "x", coordinate: CX, mode: "base", from: { x: 1060, y: 182, z: 106 }, to: { x: 1500, y: 190, z: 546 } },
    { name: "lower-ring-north-south", axis: "z", coordinate: CZ, mode: "base", from: { x: 1060, y: 182, z: 106 }, to: { x: 1500, y: 190, z: 546 } },
    { name: "upper-halo-east-west", axis: "x", coordinate: CX, mode: "base", from: { x: 1060, y: 237, z: 106 }, to: { x: 1500, y: 255, z: 546 } },
    { name: "upper-halo-north-south", axis: "z", coordinate: CZ, mode: "base", from: { x: 1060, y: 237, z: 106 }, to: { x: 1500, y: 255, z: 546 } },
  ],
  acceptance: {
    requiredViews: ["whole-port-oblique", "tokamak-through-diagonal-arm", "cardinal-research-pod", "upper-halo-and-energy-column"],
    ordinaryTraversal: ["tokamak-interface-to-ring-and-all-pods"],
    actualScanRegions: ["diagonal-arm", "orbital-ring", "pod-corridors"],
    userExclusions: ["spawn-risk-remediation"],
    recovery: { projectId: PROJECT_ID, preconstructionState: "outer-sectors-scanned-empty" },
  },
};

await mkdir("D:/AI WORK/006/output", { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(design, null, 2)}\n`);
const stats = Object.fromEntries(phaseOrder.map((phase) => [phase, {
  operations: phases[phase].length,
  grossBlocks: phases[phase].reduce((sum, op) => sum + volume(op), 0),
  parts: batches(phases[phase]).length,
}]));
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
  await call("/v1/camera/move", { position: { x: CX + 20, y: 300, z: CZ }, pitch: 90, yaw: 0, fov: 75 });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  for (const phase of selected) {
    const parts = batches(phases[phase]);
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      const result = await call("/v1/apply", {
        operations: part, dryRun: !apply, projectId: PROJECT_ID,
        label: `Sky research port v1 ${phase} ${index + 1}/${parts.length}`,
      });
      if (!apply && !result.canApply) throw new Error(`${phase} ${index + 1} cannot apply`);
      results.push({ phase, part: index + 1, parts: parts.length, operationCount: part.length, result });
    }
  }
} finally {
  await call("/v1/camera/restore", {});
}

console.log(JSON.stringify({ apply, requested, projectId: PROJECT_ID, manifest: OUTPUT, stats, results }, null, 2));
