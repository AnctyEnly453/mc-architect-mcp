import { readFile } from "node:fs/promises";

const raw = [];
const PROJECT_ID = "forbidden-city-grand-complex";

function add(block, x1, y1, z1, x2, y2, z2) {
  raw.push({
    block,
    from: { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2) },
    to: { x: Math.max(x1, x2), y: Math.max(y1, y2), z: Math.max(z1, z2) },
  });
}

function volume(op) {
  return (op.to.x - op.from.x + 1) * (op.to.y - op.from.y + 1) * (op.to.z - op.from.z + 1);
}

function tiled(block, x1, y1, z1, x2, y2, z2, tileX = 60, tileZ = 70) {
  for (let x = x1; x <= x2; x += tileX) {
    for (let z = z1; z <= z2; z += tileZ) {
      add(block, x, y1, z, Math.min(x2, x + tileX - 1), y2, Math.min(z2, z + tileZ - 1));
    }
  }
}

function ring(block, x1, y1, z1, x2, y2, z2, thickness) {
  add(block, x1, y1, z1, x1 + thickness - 1, y2, z2);
  add(block, x2 - thickness + 1, y1, z1, x2, y2, z2);
  add(block, x1 + thickness, y1, z1, x2 - thickness, y2, z1 + thickness - 1);
  add(block, x1 + thickness, y1, z2 - thickness + 1, x2 - thickness, y2, z2);
}

function hipRoof(x1, z1, x2, z2, baseY, height, doubleEave = false) {
  const eave = 4;
  add("minecraft:orange_terracotta", x1 - eave, baseY, z1 - eave, x2 + eave, baseY + 1, z2 + eave);
  add("minecraft:gold_block", x1 - eave + 1, baseY + 2, z1 - eave + 1, x2 + eave - 1, baseY + 2, z2 + eave - 1);
  for (let i = 0; i < height; i++) {
    const insetX = Math.floor(i * 1.6);
    const insetZ = i;
    if (x1 - 2 + insetX > x2 + 2 - insetX || z1 - 2 + insetZ > z2 + 2 - insetZ) break;
    add(i % 4 === 0 ? "minecraft:gold_block" : "minecraft:yellow_terracotta",
      x1 - 2 + insetX, baseY + 3 + i, z1 - 2 + insetZ,
      x2 + 2 - insetX, baseY + 3 + i, z2 + 2 - insetZ);
  }
  const ridgeY = baseY + height + 3;
  add("minecraft:gold_block", x1 + Math.floor(height * 1.4), ridgeY, Math.floor((z1 + z2) / 2) - 1,
    x2 - Math.floor(height * 1.4), ridgeY + 1, Math.floor((z1 + z2) / 2) + 1);
  if (doubleEave) {
    add("minecraft:red_concrete", x1 + 8, ridgeY - 2, z1 + 6, x2 - 8, ridgeY + 6, z2 - 6);
    add("minecraft:orange_terracotta", x1 + 4, ridgeY + 7, z1 + 2, x2 - 4, ridgeY + 8, z2 - 2);
    for (let i = 0; i < Math.max(5, height - 3); i++) {
      add(i % 3 === 0 ? "minecraft:gold_block" : "minecraft:yellow_terracotta",
        x1 + 6 + i, ridgeY + 9 + i, z1 + 4 + i,
        x2 - 6 - i, ridgeY + 9 + i, z2 - 4 - i);
    }
  }
}

function balustrade(x1, y, z1, x2, z2) {
  ring("minecraft:quartz_block", x1, y, z1, x2, y + 1, z2, 1);
  for (let x = x1; x <= x2; x += 5) {
    add("minecraft:diorite_wall", x, y + 2, z1, x, y + 4, z1);
    add("minecraft:diorite_wall", x, y + 2, z2, x, y + 4, z2);
  }
  for (let z = z1; z <= z2; z += 5) {
    add("minecraft:diorite_wall", x1, y + 2, z, x1, y + 4, z);
    add("minecraft:diorite_wall", x2, y + 2, z, x2, y + 4, z);
  }
}

function hall(cx, cz, width, depth, floorY, bodyHeight, roofHeight, options = {}) {
  const x1 = Math.round(cx - width / 2);
  const x2 = Math.round(cx + width / 2);
  const z1 = Math.round(cz - depth / 2);
  const z2 = Math.round(cz + depth / 2);
  const tiers = options.tiers ?? 2;
  for (let tier = 0; tier < tiers; tier++) {
    const expand = (tiers - tier) * 5;
    add(tier === 0 ? "minecraft:stone_bricks" : "minecraft:quartz_block",
      x1 - expand, floorY + tier * 3, z1 - expand,
      x2 + expand, floorY + tier * 3 + 2, z2 + expand);
    balustrade(x1 - expand, floorY + tier * 3 + 2, z1 - expand, x2 + expand, z2 + expand);
  }
  const base = floorY + tiers * 3;
  add("minecraft:dark_oak_planks", x1, base, z1, x2, base, z2);
  ring("minecraft:red_concrete", x1, base + 1, z1, x2, base + bodyHeight, z2, 2);
  add("minecraft:white_terracotta", x1 + 2, base + 2, z1 + 2, x2 - 2, base + 4, z2 - 2);
  // Red structural columns and cyan lattice windows.
  for (let x = x1; x <= x2; x += 8) {
    add("minecraft:red_concrete", x, base + 1, z1 - 1, x + 2, base + bodyHeight + 2, z1 + 1);
    add("minecraft:red_concrete", x, base + 1, z2 - 1, x + 2, base + bodyHeight + 2, z2 + 1);
  }
  for (let z = z1; z <= z2; z += 8) {
    add("minecraft:red_concrete", x1 - 1, base + 1, z, x1 + 1, base + bodyHeight + 2, z + 2);
    add("minecraft:red_concrete", x2 - 1, base + 1, z, x2 + 1, base + bodyHeight + 2, z + 2);
  }
  add("minecraft:cyan_stained_glass", x1 + 3, base + 6, z1, x2 - 3, base + bodyHeight - 2, z1);
  add("minecraft:cyan_stained_glass", x1 + 3, base + 6, z2, x2 - 3, base + bodyHeight - 2, z2);
  const doorHalf = Math.max(3, Math.floor(width / 12));
  add("minecraft:air", cx - doorHalf, base + 1, z2 - 2, cx + doorHalf, base + 11, z2 + 2);
  add("minecraft:dark_oak_door", cx - 1, base + 1, z2, cx, base + 2, z2);
  add("minecraft:gold_block", cx - doorHalf - 1, base + 11, z2 - 1, cx + doorHalf + 1, base + 13, z2 + 1);
  hipRoof(x1, z1, x2, z2, base + bodyHeight + 1, roofHeight, options.doubleEave ?? false);
}

function gate(cx, cz, width, depth, floorY, grand = false) {
  hall(cx, cz, width, depth, floorY, grand ? 18 : 14, grand ? 12 : 9, { tiers: grand ? 2 : 1, doubleEave: grand });
  const opening = Math.floor(width / 12);
  for (const offset of grand ? [-Math.floor(width / 3), 0, Math.floor(width / 3)] : [0]) {
    add("minecraft:air", cx + offset - opening, floorY + 1, cz - depth, cx + offset + opening, floorY + 16, cz + depth);
  }
}

function sideHall(x, z, width = 38, depth = 24) {
  hall(x, z, width, depth, 168, 11, 7, { tiers: 1 });
}

// Massive terrain-safe plinth, paving, moat, and outer wall.
tiled("minecraft:stone_bricks", 600, 160, -40, 959, 166, 519);
tiled("minecraft:smooth_stone", 600, 167, -40, 959, 167, 519);
ring("minecraft:prismarine_bricks", 600, 168, -40, 959, 168, 519, 10);
ring("minecraft:water", 601, 169, -39, 958, 171, 518, 8);
ring("minecraft:red_concrete", 612, 168, -28, 947, 184, 507, 5);
ring("minecraft:yellow_terracotta", 608, 185, -32, 951, 187, 511, 9);
ring("minecraft:gold_block", 611, 188, -29, 948, 189, 508, 6);

// Crenellations and lantern rhythm along the four palace walls.
for (let x = 616; x <= 943; x += 12) {
  add("minecraft:red_concrete", x, 190, -27, x + 4, 193, -23);
  add("minecraft:red_concrete", x, 190, 502, x + 4, 193, 506);
  add("minecraft:sea_lantern", x + 1, 181, -22, x + 3, 183, -20);
  add("minecraft:sea_lantern", x + 1, 181, 499, x + 3, 183, 501);
}
for (let z = -16; z <= 495; z += 12) {
  add("minecraft:red_concrete", 613, 190, z, 617, 193, z + 4);
  add("minecraft:red_concrete", 942, 190, z, 946, 193, z + 4);
}

// Four corner towers.
for (const [x, z] of [[632, -8], [927, -8], [632, 487], [927, 487]]) {
  hall(x, z, 42, 42, 168, 15, 10, { tiers: 1, doubleEave: true });
}

const axis = 780;
// South-to-north ceremonial axis.
gate(axis, 478, 152, 42, 168, true); // Meridian Gate
gate(axis, 397, 112, 32, 168, false); // Gate of Supreme Harmony
hall(axis, 304, 108, 56, 168, 20, 14, { tiers: 3, doubleEave: true });
hall(axis, 235, 58, 44, 168, 16, 11, { tiers: 2, doubleEave: true });
hall(axis, 171, 92, 50, 168, 18, 12, { tiers: 2, doubleEave: true });
gate(axis, 111, 92, 28, 168, false); // Gate of Heavenly Purity
hall(axis, 55, 82, 44, 168, 17, 11, { tiers: 2, doubleEave: true });
hall(axis, 5, 72, 38, 168, 15, 10, { tiers: 2, doubleEave: false });

// Golden Water River and five marble bridges.
add("minecraft:prismarine_bricks", 670, 168, 365, 890, 168, 380);
add("minecraft:water", 670, 169, 365, 890, 171, 380);
for (const x of [704, 742, 780, 818, 856]) {
  add("minecraft:quartz_block", x - 5, 172, 360, x + 5, 174, 385);
  add("minecraft:diorite_wall", x - 6, 175, 360, x - 5, 178, 385);
  add("minecraft:diorite_wall", x + 5, 175, 360, x + 6, 178, 385);
}

// Imperial road, dragon-ramp approaches, and transverse courtyard paths.
add("minecraft:polished_andesite", 770, 168, -20, 790, 169, 500);
add("minecraft:quartz_block", 773, 170, 277, 787, 177, 330);
for (const z of [430, 350, 270, 205, 140, 85, 30]) {
  add("minecraft:smooth_stone", 635, 168, z - 5, 924, 169, z + 5);
}

// Symmetrical side courts and administrative halls.
for (const z of [430, 340, 275, 215, 155, 95, 45]) {
  sideHall(680, z, z > 300 ? 56 : 44, 26);
  sideHall(880, z, z > 300 ? 56 : 44, 26);
}
for (const x of [650, 710, 850, 910]) {
  sideHall(x, 300, 38, 52);
  sideHall(x, 190, 34, 44);
  sideHall(x, 55, 34, 36);
}

// Inner-court wall, gates, garden pavilions, ponds, and cypress rows.
add("minecraft:red_concrete", 618, 168, 132, 942, 181, 138);
add("minecraft:yellow_terracotta", 615, 182, 129, 945, 185, 141);
add("minecraft:air", 766, 168, 128, 794, 181, 142);
for (const x of [690, 870]) gate(x, 135, 42, 18, 168, false);

add("minecraft:prismarine_bricks", 650, 168, -18, 710, 168, 20);
add("minecraft:water", 654, 169, -14, 706, 171, 16);
add("minecraft:prismarine_bricks", 850, 168, -18, 910, 168, 20);
add("minecraft:water", 854, 169, -14, 906, 171, 16);
for (const [x, z] of [[690, -4], [870, -4], [720, 24], [840, 24]]) hall(x, z, 28, 22, 168, 10, 7, { tiers: 1 });

for (const x of [630, 650, 670, 890, 910, 930]) {
  for (const z of [70, 115, 220, 260, 330, 410]) {
    add("minecraft:dark_oak_log", x, 168, z, x + 2, 181, z + 2);
    add("minecraft:dark_oak_leaves", x - 5, 178, z - 5, x + 7, 190, z + 7);
  }
}

// Split very large cuboids and group operations below transaction limits.
const operations = [];
for (const op of raw) {
  const maxVolume = 48000;
  if (volume(op) <= maxVolume) {
    operations.push(op);
    continue;
  }
  const dx = op.to.x - op.from.x + 1;
  const dy = op.to.y - op.from.y + 1;
  const dz = op.to.z - op.from.z + 1;
  const stepX = Math.max(1, Math.min(dx, Math.floor(maxVolume / Math.max(1, dy * dz))));
  for (let x = op.from.x; x <= op.to.x; x += stepX) {
    operations.push({ ...op, from: { ...op.from, x }, to: { ...op.to, x: Math.min(op.to.x, x + stepX - 1) } });
  }
}

const chunks = [];
let current = [];
let currentVolume = 0;
for (const op of operations) {
  const opVolume = volume(op);
  if (current.length >= 190 || currentVolume + opVolume > 190000) {
    chunks.push(current);
    current = [];
    currentVolume = 0;
  }
  current.push(op);
  currentVolume += opVolume;
}
if (current.length) chunks.push(current);

const totalPlacedVolume = operations.reduce((sum, op) => sum + volume(op), 0);
const config = JSON.parse(await readFile("D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8"));
const apply = process.argv.includes("--apply");
const results = [];
for (let index = 0; index < chunks.length; index++) {
  const response = await fetch(`http://127.0.0.1:${config.port}/v1/apply`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      operations: chunks[index],
      label: `Forbidden City grand complex ${index + 1}/${chunks.length}`,
      projectId: PROJECT_ID,
      dryRun: !apply,
    }),
  });
  const result = await response.json();
  results.push({ part: index + 1, operationCount: chunks[index].length, status: response.status, result });
  if (!response.ok || (!apply && !result.canApply)) break;
}

console.log(JSON.stringify({ apply, rawOperations: raw.length, operationCount: operations.length, chunks: chunks.length, totalPlacedVolume, parts: results }, null, 2));
if (results.some((part) => part.status >= 400 || (!apply && !part.result.canApply))) process.exitCode = 1;
