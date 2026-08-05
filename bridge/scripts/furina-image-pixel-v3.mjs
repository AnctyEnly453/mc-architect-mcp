import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { PNG } = require("C:/Users/yaoyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs");

const W = 160;
const H = 160;
const INPUT = "output/imagegen/furina-moonlit-fanart.png";
const PROJECT_ID = "furina-moonlit-pixel-v4";

const palette = [
  { block: "minecraft:coal_block", rgb: [16, 16, 16] },
  { block: "minecraft:black_concrete", rgb: [20, 21, 25] },
  { block: "minecraft:deepslate_tiles", rgb: [52, 49, 54] },
  { block: "minecraft:gray_concrete", rgb: [55, 58, 62] },
  { block: "minecraft:polished_deepslate", rgb: [72, 72, 74] },
  { block: "minecraft:smooth_basalt", rgb: [72, 72, 78] },
  { block: "minecraft:gray_wool", rgb: [62, 68, 71] },
  { block: "minecraft:cyan_terracotta", rgb: [87, 91, 91] },
  { block: "minecraft:light_gray_concrete", rgb: [125, 125, 115] },
  { block: "minecraft:stone", rgb: [126, 126, 126] },
  { block: "minecraft:light_gray_wool", rgb: [142, 142, 134] },
  { block: "minecraft:diorite", rgb: [188, 188, 188] },
  { block: "minecraft:bone_block", rgb: [229, 225, 207] },
  { block: "minecraft:quartz_block", rgb: [232, 228, 220] },
  { block: "minecraft:calcite", rgb: [223, 224, 220] },
  { block: "minecraft:white_concrete", rgb: [236, 236, 236] },
  { block: "minecraft:snow_block", rgb: [249, 254, 254] },
  { block: "minecraft:sea_lantern", rgb: [172, 199, 190] },
  { block: "minecraft:white_terracotta", rgb: [210, 178, 161] },
  { block: "minecraft:pink_terracotta", rgb: [162, 78, 79] },
  { block: "minecraft:red_terracotta", rgb: [143, 61, 47] },
  { block: "minecraft:orange_terracotta", rgb: [161, 83, 37] },
  { block: "minecraft:sandstone", rgb: [216, 203, 155] },
  { block: "minecraft:birch_planks", rgb: [192, 175, 121] },
  { block: "minecraft:brown_terracotta", rgb: [77, 51, 36] },
  { block: "minecraft:yellow_concrete", rgb: [241, 175, 21] },
  { block: "minecraft:yellow_wool", rgb: [249, 198, 39] },
  { block: "minecraft:yellow_terracotta", rgb: [186, 133, 35] },
  { block: "minecraft:raw_gold_block", rgb: [221, 169, 46] },
  { block: "minecraft:gold_block", rgb: [246, 208, 61] },
  { block: "minecraft:blue_concrete", rgb: [44, 46, 143] },
  { block: "minecraft:blue_wool", rgb: [53, 57, 157] },
  { block: "minecraft:lapis_block", rgb: [31, 67, 140] },
  { block: "minecraft:blue_terracotta", rgb: [74, 60, 91] },
  { block: "minecraft:purple_concrete", rgb: [100, 32, 156] },
  { block: "minecraft:purple_wool", rgb: [122, 42, 173] },
  { block: "minecraft:magenta_terracotta", rgb: [149, 88, 108] },
  { block: "minecraft:magenta_concrete", rgb: [169, 48, 159] },
  { block: "minecraft:magenta_wool", rgb: [189, 68, 179] },
  { block: "minecraft:pink_concrete", rgb: [214, 101, 143] },
  { block: "minecraft:pink_wool", rgb: [238, 141, 172] },
  { block: "minecraft:cyan_concrete", rgb: [21, 137, 145] },
  { block: "minecraft:cyan_wool", rgb: [21, 138, 145] },
  { block: "minecraft:dark_prismarine", rgb: [51, 91, 75] },
  { block: "minecraft:prismarine_bricks", rgb: [99, 171, 158] },
  { block: "minecraft:light_blue_concrete", rgb: [36, 137, 199] },
  { block: "minecraft:light_blue_wool", rgb: [58, 175, 217] },
  { block: "minecraft:packed_ice", rgb: [141, 180, 250] },
  { block: "minecraft:blue_ice", rgb: [116, 167, 253] },
];

function srgbToLinear(value) {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function rgbToLab([r, g, b]) {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  let x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  let y = (rl * 0.2126 + gl * 0.7152 + bl * 0.0722);
  let z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  const f = (v) => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

for (const entry of palette) entry.lab = rgbToLab(entry.rgb);

function closestPalette(rgb) {
  const [l, a, b] = rgbToLab(rgb);
  let best = palette[0];
  let bestDistance = Infinity;
  for (const entry of palette) {
    const [pl, pa, pb] = entry.lab;
    const distance = (l - pl) ** 2 + (a - pa) ** 2 * 0.72 + (b - pb) ** 2 * 0.72;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  return best;
}

function areaAverage(source, targetX, targetY) {
  const sx0 = targetX * source.width / W;
  const sx1 = (targetX + 1) * source.width / W;
  const sy0 = targetY * source.height / H;
  const sy1 = (targetY + 1) * source.height / H;
  let red = 0;
  let green = 0;
  let blue = 0;
  let weightTotal = 0;
  for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
    const wy = Math.max(0, Math.min(sy1, sy + 1) - Math.max(sy0, sy));
    for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
      const wx = Math.max(0, Math.min(sx1, sx + 1) - Math.max(sx0, sx));
      const weight = wx * wy;
      const offset = (Math.min(source.height - 1, sy) * source.width + Math.min(source.width - 1, sx)) * 4;
      red += source.data[offset] * weight;
      green += source.data[offset + 1] * weight;
      blue += source.data[offset + 2] * weight;
      weightTotal += weight;
    }
  }
  let r = red / weightTotal;
  let g = green / weightTotal;
  let b = blue / weightTotal;
  const gray = r * 0.299 + g * 0.587 + b * 0.114;
  r = gray + (r - gray) * 1.08;
  g = gray + (g - gray) * 1.08;
  b = gray + (b - gray) * 1.08;
  r = 128 + (r - 128) * 1.04;
  g = 128 + (g - 128) * 1.04;
  b = 128 + (b - 128) * 1.04;
  return [r, g, b].map((value) => Math.max(0, Math.min(255, value)));
}

const source = PNG.sync.read(await readFile(INPUT));
const pixels = Array.from({ length: H }, () => Array(W));
let totalLabError = 0;
let usedColors = new Set();
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const target = areaAverage(source, x, y);
    const chosen = closestPalette(target);
    pixels[y][x] = chosen;
    usedColors.add(chosen.block);
    const [l, a, b] = rgbToLab(target);
    const [pl, pa, pb] = chosen.lab;
    totalLabError += Math.sqrt((l - pl) ** 2 + (a - pa) ** 2 * 0.72 + (b - pb) ** 2 * 0.72);
  }
}

function compressedOperations() {
  const rectangles = [];
  const used = Array.from({ length: H }, () => Array(W).fill(false));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const color = pixels[y][x];
    if (used[y][x]) continue;
    let maxWidth = 0;
    while (x + maxWidth < W && pixels[y][x + maxWidth] === color && !used[y][x + maxWidth]) maxWidth++;
    let bestWidth = maxWidth;
    let bestHeight = 1;
    let width = maxWidth;
    for (let yy = y + 1; yy < H && width > 0; yy++) {
      let rowWidth = 0;
      while (rowWidth < width && pixels[yy][x + rowWidth] === color && !used[yy][x + rowWidth]) rowWidth++;
      width = Math.min(width, rowWidth);
      if (width === 0) break;
      const height = yy - y + 1;
      if (width * height > bestWidth * bestHeight) {
        bestWidth = width;
        bestHeight = height;
      }
    }
    for (let yy = y; yy < y + bestHeight; yy++) {
      for (let xx = x; xx < x + bestWidth; xx++) used[yy][xx] = true;
    }
    rectangles.push({ color, x1: x, x2: x + bestWidth - 1, y1: y, y2: y + bestHeight - 1 });
  }
  return rectangles.map((r) => ({
    from: { x: 480, y: 244 - r.y2, z: 75 + r.x1 },
    to: { x: 480, y: 244 - r.y1, z: 75 + r.x2 },
    block: r.color.block,
  }));
}

async function writePreview() {
  const scale = 4;
  const png = new PNG({ width: W * scale, height: H * scale });
  for (let y = 0; y < H * scale; y++) for (let x = 0; x < W * scale; x++) {
    const [r, g, b] = pixels[Math.floor(y / scale)][Math.floor(x / scale)].rgb;
    const offset = (y * png.width + x) * 4;
    png.data[offset] = r;
    png.data[offset + 1] = g;
    png.data[offset + 2] = b;
    png.data[offset + 3] = 255;
  }
  await mkdir("output/imagegen", { recursive: true });
  await writeFile("output/imagegen/furina-moonlit-minecraft-preview-v4.png", PNG.sync.write(png));
}

await writePreview();
const operations = compressedOperations();
const chunks = [];
for (let index = 0; index < operations.length; index += 220) chunks.push(operations.slice(index, index + 220));
const materials = Object.fromEntries(palette.map((entry) => [entry.block, 0]));
for (const row of pixels) for (const entry of row) materials[entry.block]++;

if (!process.argv.includes("--build")) {
  console.log(JSON.stringify({ width: W, height: H, blocks: W * H, paletteSize: palette.length, usedColorCount: usedColors.size, meanLabError: totalLabError / (W * H), operationCount: operations.length, chunks: chunks.length, materials, preview: "output/imagegen/furina-moonlit-minecraft-preview-v4.png" }, null, 2));
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
        label: `Furina moonlit high-color pixel art ${index + 1}/${chunks.length}`,
        projectId: PROJECT_ID,
        dryRun: !apply,
      }),
    });
    const result = await response.json();
    results.push({ part: index + 1, operationCount: chunks[index].length, status: response.status, result });
    if (!response.ok || (!apply && !result.canApply)) break;
  }
  console.log(JSON.stringify({ apply, operationCount: operations.length, parts: results }, null, 2));
  if (results.some((part) => part.status >= 400 || (!apply && !part.result.canApply))) process.exitCode = 1;
}
