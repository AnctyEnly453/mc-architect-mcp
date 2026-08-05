import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { PNG } = require("C:/Users/yaoyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs");

const voxels = new Map();
const key = (x, y, z) => `${x},${y},${z}`;

const B = {
  outline: "minecraft:black_concrete",
  shadow: "minecraft:blue_terracotta",
  navy: "minecraft:blue_concrete",
  royal: "minecraft:lapis_block",
  cyan: "minecraft:cyan_concrete",
  aqua: "minecraft:light_blue_concrete",
  ice: "minecraft:packed_ice",
  glow: "minecraft:sea_lantern",
  white: "minecraft:white_concrete",
  pearl: "minecraft:quartz_block",
  silver: "minecraft:light_gray_concrete",
  skin: "minecraft:white_terracotta",
  skinLight: "minecraft:smooth_sandstone",
  blush: "minecraft:pink_terracotta",
  gold: "minecraft:gold_block",
  darkGold: "minecraft:yellow_terracotta",
  base: "minecraft:dark_prismarine",
  water: "minecraft:prismarine_bricks",
};

function set(x, y, z, block) {
  voxels.set(key(Math.round(x), Math.round(y), Math.round(z)), block);
}

function box(x1, y1, z1, x2, y2, z2, block) {
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) set(x, y, z, block);
}

function ellipsoid(cx, cy, cz, rx, ry, rz, block) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
        const value = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
        if (value <= 1) set(x, y, z, block);
      }
    }
  }
}

function taperedY(cx, y1, y2, cz, rx1, rz1, rx2, rz2, block) {
  for (let y = y1; y <= y2; y++) {
    const t = (y - y1) / Math.max(1, y2 - y1);
    const rx = rx1 + (rx2 - rx1) * t;
    const rz = rz1 + (rz2 - rz1) * t;
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
        if (((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 <= 1) set(x, y, z, block);
      }
    }
  }
}

function line(x1, y1, z1, x2, y2, z2, radius, block) {
  const steps = Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), Math.abs(z2 - z1)) * 1.5);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    ellipsoid(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, z1 + (z2 - z1) * t, radius, radius, radius, block);
  }
}

function ringY(cx, y, cz, outer, inner, block, height = 1) {
  for (let yy = y; yy < y + height; yy++) for (let x = cx - outer; x <= cx + outer; x++) for (let z = cz - outer; z <= cz + outer; z++) {
    const d = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2);
    if (d <= outer && d >= inner) set(x, yy, z, block);
  }
}

// Floating Fontaine pedestal and luminous water crest.
for (let y = 84; y <= 89; y++) {
  const radius = 23 - Math.abs(86 - y) * 2;
  ellipsoid(515, y, 270, radius, 1.2, radius, y === 86 ? B.water : B.base);
}
ringY(515, 90, 270, 20, 15, B.gold, 2);
ellipsoid(515, 90, 270, 15, 2, 15, B.pearl);
ringY(515, 92, 270, 14, 11, B.aqua, 1);
for (const angle of [0, 60, 120, 180, 240, 300]) {
  const radians = angle * Math.PI / 180;
  const x = 515 + Math.round(Math.cos(radians) * 18);
  const z = 270 + Math.round(Math.sin(radians) * 18);
  ellipsoid(x, 94, z, 2, 4, 2, B.glow);
  ellipsoid(x, 98, z, 1, 2, 1, B.ice);
}

// Boots, heels, and deliberately asymmetric legs.
taperedY(515, 93, 105, 262, 4.5, 5, 3.7, 4.3, B.outline);
taperedY(515, 95, 105, 262, 3.4, 4.1, 3, 3.6, B.navy);
box(510, 92, 257, 516, 95, 265, B.outline);
box(516, 92, 260, 519, 94, 267, B.outline);
taperedY(515, 93, 105, 278, 4.5, 5, 3.7, 4.3, B.outline);
taperedY(515, 95, 105, 278, 3.4, 4.1, 3, 3.6, B.navy);
box(510, 92, 273, 516, 95, 281, B.outline);
box(516, 92, 276, 519, 94, 283, B.outline);

taperedY(515, 105, 128, 262, 3.5, 4, 4.5, 5, B.skin);
taperedY(515, 105, 128, 278, 3.5, 4, 4.5, 5, B.shadow);
// White ruffled stocking on one leg, dark diamond garter on the other.
taperedY(515, 105, 117, 262, 3.7, 4.2, 4, 4.5, B.white);
ringY(515, 116, 262, 5, 3, B.aqua, 2);
for (let y = 108; y <= 124; y += 6) {
  set(511, y, 278, B.aqua); set(511, y + 1, 277, B.aqua); set(511, y + 2, 278, B.aqua);
}

// Shorts, hips, fitted waistcoat and flared tailcoat.
ellipsoid(515, 130, 270, 8, 7, 14, B.outline);
ellipsoid(514, 130, 264, 6.5, 5.5, 7, B.white);
ellipsoid(514, 130, 276, 6.5, 5.5, 7, B.white);
box(507, 128, 269, 510, 133, 271, B.gold);
taperedY(515, 133, 153, 270, 8, 14, 7, 12, B.outline);
taperedY(514, 134, 152, 270, 6.7, 12.5, 5.8, 10.5, B.navy);
// White shirt front, ruffles, buttons and Hydro jewel.
taperedY(507, 137, 153, 270, 1.5, 6, 1.5, 7, B.white);
for (let y = 139; y <= 150; y += 4) ellipsoid(505, y, 270, 1.5, 1.5, 6 + (150 - y) / 4, B.pearl);
for (let y = 137; y <= 149; y += 5) ellipsoid(504, y, 270, 1, 1, 1, B.gold);
ellipsoid(503, 151, 270, 2, 3, 3, B.gold);
ellipsoid(502, 151, 270, 1, 2, 2, B.aqua);

// Split coat tails with gold trim and a layered back bow.
line(518, 136, 262, 522, 112, 256, 6, B.outline);
line(518, 136, 278, 522, 112, 284, 6, B.outline);
line(517, 136, 263, 520, 114, 258, 4.5, B.navy);
line(517, 136, 277, 520, 114, 282, 4.5, B.navy);
line(514, 136, 261, 518, 116, 257, 1.2, B.gold);
line(514, 136, 279, 518, 116, 283, 1.2, B.gold);
ellipsoid(523, 139, 270, 4, 4, 5, B.aqua);
ellipsoid(523, 139, 260, 4, 5, 8, B.white);
ellipsoid(523, 139, 280, 4, 5, 8, B.ice);

// Left arm lowered outward, right arm raised in a theatrical pose.
line(514, 149, 258, 510, 137, 246, 5, B.outline);
line(512, 148, 258, 508, 138, 247, 3.8, B.white);
line(508, 138, 247, 505, 126, 244, 3.8, B.navy);
ellipsoid(504, 124, 243, 3.5, 4.5, 3.5, B.skin);

line(514, 149, 282, 512, 162, 291, 5, B.outline);
line(512, 149, 282, 510, 161, 291, 3.8, B.white);
line(510, 161, 291, 507, 176, 295, 3.5, B.navy);
ellipsoid(506, 179, 296, 3.5, 4.5, 3.5, B.skin);
for (const [dy, dz] of [[3, -2], [4, 0], [3, 2]]) line(505, 181, 296, 503, 185 + dy / 2, 296 + dz, 1, B.skin);

// Neck, head and ears. The statue faces west (negative X).
taperedY(515, 153, 160, 270, 4, 5, 4.5, 5.5, B.skin);
ellipsoid(514, 172, 270, 13, 15, 14, B.outline);
ellipsoid(512, 171, 270, 11, 13, 11.5, B.skin);
ellipsoid(511, 171, 257, 2.5, 4, 3, B.skin);
ellipsoid(511, 171, 283, 2.5, 4, 3, B.skin);

// Voluminous bob, fringe and curled side locks.
ellipsoid(516, 176, 270, 13, 14, 15, B.white);
ellipsoid(510, 171, 270, 11, 12, 11, B.skin);
line(506, 184, 260, 501, 174, 263, 3.5, B.white);
line(506, 185, 269, 500, 176, 268, 3.8, B.pearl);
line(507, 184, 278, 501, 174, 276, 3.5, B.ice);
line(512, 176, 258, 514, 160, 255, 3.5, B.white);
line(512, 176, 282, 514, 160, 285, 3.5, B.ice);

// Long aqua hair tails curve down the back and remain readable from side views.
line(524, 176, 258, 527, 156, 251, 5, B.outline);
line(527, 156, 251, 525, 132, 248, 4.5, B.outline);
line(523, 176, 259, 525, 156, 252, 3.8, B.white);
line(525, 156, 252, 523, 133, 249, 3.2, B.ice);
line(524, 176, 282, 527, 156, 289, 5, B.outline);
line(527, 156, 289, 525, 132, 292, 4.5, B.outline);
line(523, 176, 281, 525, 156, 288, 3.8, B.ice);
line(525, 156, 288, 523, 133, 291, 3.2, B.aqua);

// Face details on the west-facing surface.
box(500, 173, 262, 501, 176, 267, B.outline);
box(499, 174, 263, 500, 176, 266, B.aqua);
set(499, 176, 264, B.white);
box(500, 173, 273, 501, 176, 278, B.outline);
box(499, 174, 274, 500, 176, 277, B.royal);
set(499, 176, 275, B.white);
set(500, 169, 261, B.blush); set(500, 169, 279, B.blush);
box(499, 166, 267, 500, 167, 273, B.blush);
box(499, 167, 269, 500, 167, 271, B.white);

// Asymmetrical top hat, crown ornament and pale feather.
ellipsoid(514, 188, 270, 11, 2.5, 20, B.outline);
ellipsoid(513, 189, 270, 9, 1.5, 18, B.navy);
taperedY(516, 189, 203, 274, 9, 13, 7, 10, B.outline);
taperedY(515, 190, 202, 274, 7.5, 11.5, 6, 8.5, B.navy);
ringY(515, 192, 274, 11, 8, B.royal, 2);
ellipsoid(506, 195, 273, 2.5, 3.5, 3, B.gold);
for (const [z, top] of [[267, 208], [273, 211], [279, 207]]) line(515, 201, z, 514, top, z, 1.7, B.gold);
line(515, 198, 283, 510, 210, 292, 2.5, B.white);
line(513, 201, 286, 508, 207, 297, 1.8, B.ice);

// Floating Hydro droplets around the silhouette.
for (const [x, y, z, size] of [[500, 147, 238, 3], [522, 164, 302, 4], [528, 122, 299, 3], [500, 111, 246, 2]]) {
  ellipsoid(x, y, z, size, size * 1.7, size, B.glow);
  line(x, y + size, z, x, y + size * 2.5, z, Math.max(1, size - 1), B.aqua);
}

// Rear-facing highlights keep the twin tails and coat split legible in silhouette.
line(528, 174, 258, 530, 156, 251, 2.2, B.aqua);
line(530, 156, 251, 527, 134, 248, 1.8, B.ice);
line(528, 174, 282, 530, 156, 289, 2.2, B.ice);
line(530, 156, 289, 527, 134, 292, 1.8, B.aqua);
line(524, 136, 262, 526, 115, 257, 1.3, B.gold);
line(524, 136, 278, 526, 115, 283, 1.3, B.gold);

// Clear the old face relief before rebuilding it. This removes the previous
// square eyes and wide mouth while leaving the rear head and hair volume intact.
box(496, 157, 257, 500, 183, 283, "minecraft:air");

// A shallow tapered face plate: broad temples, soft cheeks, and a narrow chin.
for (let y = 160; y <= 182; y++) {
  const halfWidth = y >= 176 ? 11
    : y >= 168 ? 10
      : y >= 163 ? 8
        : 5 + (y - 160);
  for (let z = 270 - halfWidth; z <= 270 + halfWidth; z++) {
    set(499, y, z, B.skin);
    set(500, y, z, B.skin);
  }
}
box(499, 181, 262, 499, 182, 278, B.skinLight);

// Raised, parted fringe and side locks expose both eyes.
line(500, 182, 260, 498, 177, 264, 2.4, B.white);
line(500, 183, 268, 498, 178, 268, 2.8, B.pearl);
line(500, 182, 280, 498, 177, 276, 2.4, B.ice);
line(500, 177, 259, 499, 163, 258, 2.5, B.white);
line(500, 177, 281, 499, 163, 282, 2.5, B.ice);

// Almond-shaped eyes: four blocks high, with tapered corners and vertical irises.
// Left eye.
box(498, 175, 263, 498, 175, 267, B.outline);
set(498, 174, 262, B.outline); set(498, 174, 268, B.outline);
box(498, 174, 263, 498, 174, 267, B.white);
set(498, 173, 262, B.outline); set(498, 173, 268, B.outline);
set(498, 173, 263, B.white); set(498, 173, 267, B.white);
box(498, 173, 264, 498, 174, 266, B.aqua);
set(498, 173, 265, B.royal); set(498, 174, 265, B.royal);
set(498, 174, 264, B.white);
box(498, 172, 263, 498, 172, 267, B.outline);
set(498, 176, 262, B.outline);

// Right eye, with a slightly lighter iris.
box(498, 175, 273, 498, 175, 277, B.outline);
set(498, 174, 272, B.outline); set(498, 174, 278, B.outline);
box(498, 174, 273, 498, 174, 277, B.white);
set(498, 173, 272, B.outline); set(498, 173, 278, B.outline);
set(498, 173, 273, B.white); set(498, 173, 277, B.white);
box(498, 173, 274, 498, 174, 276, B.ice);
set(498, 173, 275, B.royal); set(498, 174, 275, B.royal);
set(498, 174, 276, B.white);
box(498, 172, 273, 498, 172, 277, B.outline);
set(498, 176, 278, B.outline);

// Fine brows, a two-pixel nose, tiny cheek accents, and a three-pixel mouth.
box(498, 178, 263, 498, 178, 267, B.shadow);
set(498, 179, 264, B.shadow);
box(498, 178, 273, 498, 178, 277, B.shadow);
set(498, 179, 276, B.shadow);
set(498, 170, 269, B.skin);
set(498, 169, 270, B.skin);
set(498, 168, 271, B.blush);
box(498, 164, 269, 498, 164, 271, B.blush);

async function applyPortraitFace() {
  const source = PNG.sync.read(await readFile("output/imagegen/furina-moonlit-fanart.png"));
  const portraitPalette = [
    { block: B.outline, rgb: [20, 21, 25] },
    { block: B.shadow, rgb: [74, 60, 91] },
    { block: B.navy, rgb: [44, 46, 143] },
    { block: B.royal, rgb: [31, 67, 140] },
    { block: "minecraft:blue_wool", rgb: [53, 57, 157] },
    { block: B.aqua, rgb: [36, 137, 199] },
    { block: B.ice, rgb: [141, 180, 250] },
    { block: B.white, rgb: [236, 236, 236] },
    { block: B.pearl, rgb: [232, 228, 220] },
    { block: "minecraft:calcite", rgb: [223, 224, 220] },
    { block: "minecraft:diorite", rgb: [188, 188, 188] },
    { block: B.silver, rgb: [125, 125, 115] },
    { block: B.skin, rgb: [210, 178, 161] },
    { block: B.skinLight, rgb: [224, 205, 169] },
    { block: B.blush, rgb: [162, 78, 79] },
    { block: "minecraft:orange_terracotta", rgb: [161, 83, 37] },
  ];
  const size = 33;
  const crop = { x: 450, y: 285, width: 330, height: 330 };
  const sample = (column, row) => {
    const sx0 = crop.x + column * crop.width / size;
    const sx1 = crop.x + (column + 1) * crop.width / size;
    const sy0 = crop.y + row * crop.height / size;
    const sy1 = crop.y + (row + 1) * crop.height / size;
    let r = 0; let g = 0; let b = 0; let count = 0;
    for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
      const offset = (Math.min(source.height - 1, sy) * source.width + Math.min(source.width - 1, sx)) * 4;
      r += source.data[offset]; g += source.data[offset + 1]; b += source.data[offset + 2]; count++;
    }
    return [r / count, g / count, b / count];
  };
  const closest = (rgb) => portraitPalette.reduce((best, entry) => {
    const distance = (rgb[0] - entry.rgb[0]) ** 2 * 0.3
      + (rgb[1] - entry.rgb[1]) ** 2 * 0.45
      + (rgb[2] - entry.rgb[2]) ** 2 * 0.25;
    return distance < best.distance ? { entry, distance } : best;
  }, { entry: portraitPalette[0], distance: Infinity }).entry;

  box(494, 155, 253, 500, 189, 287, "minecraft:air");
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const nx = (column - 16) / 16;
    const ny = (row - 16) / 16;
    if (nx ** 2 + ny ** 2 > 1.06) continue;
    set(498, 188 - row, 254 + column, closest(sample(column, row)).block);
  }
}

await applyPortraitFace();

function compressedOperations() {
  const runs = [];
  const entries = [...voxels.entries()].map(([position, block]) => {
    const [x, y, z] = position.split(",").map(Number);
    return { x, y, z, block };
  }).sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);

  for (let i = 0; i < entries.length;) {
    const start = entries[i];
    let endX = start.x;
    let j = i + 1;
    while (j < entries.length && entries[j].y === start.y && entries[j].z === start.z
      && entries[j].block === start.block && entries[j].x === endX + 1) {
      endX = entries[j].x;
      j++;
    }
    runs.push({ x1: start.x, x2: endX, y: start.y, z: start.z, block: start.block });
    i = j;
  }

  const mergedZ = [];
  const consumed = new Set();
  const byKey = new Map(runs.map((run, index) => [`${run.y},${run.z},${run.x1},${run.x2},${run.block}`, index]));
  for (let i = 0; i < runs.length; i++) {
    if (consumed.has(i)) continue;
    const run = runs[i];
    let z2 = run.z;
    consumed.add(i);
    while (true) {
      const next = byKey.get(`${run.y},${z2 + 1},${run.x1},${run.x2},${run.block}`);
      if (next === undefined || consumed.has(next)) break;
      consumed.add(next);
      z2++;
    }
    mergedZ.push({ x1: run.x1, x2: run.x2, y1: run.y, y2: run.y, z1: run.z, z2, block: run.block });
  }

  return mergedZ.map((r) => ({
    from: { x: r.x1, y: r.y1, z: r.z1 },
    to: { x: r.x2, y: r.y2, z: r.z2 },
    block: r.block,
  }));
}

const operations = compressedOperations();
const chunks = [];
for (let index = 0; index < operations.length; index += 220) chunks.push(operations.slice(index, index + 220));
const materialCounts = {};
for (const block of voxels.values()) materialCounts[block] = (materialCounts[block] ?? 0) + 1;

async function writeFacePreview() {
  const colors = new Map([
    [B.outline, [20, 21, 25]], [B.shadow, [74, 60, 91]], [B.navy, [44, 46, 143]],
    [B.royal, [31, 67, 140]], [B.aqua, [36, 137, 199]], [B.ice, [141, 180, 250]],
    [B.white, [236, 236, 236]], [B.pearl, [232, 228, 220]], [B.silver, [125, 125, 115]],
    [B.skin, [210, 178, 161]], [B.skinLight, [224, 205, 169]], [B.blush, [162, 78, 79]],
    [B.gold, [246, 208, 61]], [B.darkGold, [186, 133, 35]], [B.glow, [172, 199, 190]],
  ]);
  const z1 = 250;
  const z2 = 290;
  const y1 = 154;
  const y2 = 207;
  const scale = 8;
  const png = new PNG({ width: (z2 - z1 + 1) * scale, height: (y2 - y1 + 1) * scale });
  for (let py = 0; py <= y2 - y1; py++) for (let pz = 0; pz <= z2 - z1; pz++) {
    const y = y2 - py;
    const z = z1 + pz;
    let block = null;
    for (let x = 490; x <= 540; x++) {
      const candidate = voxels.get(key(x, y, z));
      if (candidate && candidate !== "minecraft:air") { block = candidate; break; }
    }
    const rgb = colors.get(block) ?? [35, 38, 50];
    for (let yy = py * scale; yy < (py + 1) * scale; yy++) for (let xx = pz * scale; xx < (pz + 1) * scale; xx++) {
      const offset = (yy * png.width + xx) * 4;
      png.data[offset] = rgb[0]; png.data[offset + 1] = rgb[1]; png.data[offset + 2] = rgb[2]; png.data[offset + 3] = 255;
    }
  }
  await mkdir("output", { recursive: true });
  await writeFile("output/furina-3d-face-preview.png", PNG.sync.write(png));
}

await writeFacePreview();

if (!process.argv.includes("--build")) {
  console.log(JSON.stringify({ blocks: voxels.size, operationCount: operations.length, chunks: chunks.length, materialCounts, facePreview: "output/furina-3d-face-preview.png" }, null, 2));
} else {
  const config = JSON.parse(await readFile("D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8"));
  const apply = process.argv.includes("--apply");
  const results = [];
  for (let index = 0; index < chunks.length; index++) {
    const response = await fetch(`http://127.0.0.1:${config.port}/v1/apply`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        operations: chunks[index],
        label: `Furina 3D statue ${index + 1}/${chunks.length}`,
        projectId: "furina-3d-statue",
        dryRun: !apply,
      }),
    });
    const result = await response.json();
    results.push({ part: index + 1, operationCount: chunks[index].length, status: response.status, result });
    if (!response.ok || (!apply && !result.canApply)) break;
  }
  console.log(JSON.stringify({ apply, blocks: voxels.size, operationCount: operations.length, parts: results }, null, 2));
  if (results.some((part) => part.status >= 400 || (!apply && !part.result.canApply))) process.exitCode = 1;
}
