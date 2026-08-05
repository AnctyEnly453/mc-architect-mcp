import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { PNG } = require("C:/Users/yaoyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs");

const W = 128;
const H = 128;
const pixels = Array.from({ length: H }, () => Array(W).fill(null));

const C = {
  ink: { block: "minecraft:black_concrete", rgb: [20, 21, 25] },
  frame: { block: "minecraft:polished_blackstone", rgb: [48, 42, 50] },
  night: { block: "minecraft:blue_terracotta", rgb: [74, 60, 91] },
  navy: { block: "minecraft:blue_concrete", rgb: [44, 46, 143] },
  royal: { block: "minecraft:lapis_block", rgb: [31, 67, 140] },
  purple: { block: "minecraft:purple_concrete", rgb: [100, 32, 156] },
  lavender: { block: "minecraft:magenta_terracotta", rgb: [149, 88, 108] },
  cyan: { block: "minecraft:cyan_concrete", rgb: [21, 137, 145] },
  aqua: { block: "minecraft:light_blue_concrete", rgb: [36, 137, 199] },
  ice: { block: "minecraft:light_blue_wool", rgb: [58, 175, 217] },
  white: { block: "minecraft:white_concrete", rgb: [236, 236, 236] },
  pearl: { block: "minecraft:quartz_block", rgb: [232, 228, 220] },
  silver: { block: "minecraft:light_gray_concrete", rgb: [125, 125, 115] },
  gray: { block: "minecraft:gray_concrete", rgb: [54, 57, 61] },
  skin: { block: "minecraft:white_terracotta", rgb: [210, 178, 161] },
  blush: { block: "minecraft:pink_terracotta", rgb: [162, 78, 79] },
  gold: { block: "minecraft:yellow_concrete", rgb: [241, 175, 21] },
  paleGold: { block: "minecraft:yellow_terracotta", rgb: [186, 133, 35] },
};

function set(x, y, color) {
  if (x >= 0 && x < W && y >= 0 && y < H) pixels[y][x] = color;
}

function rect(x1, y1, x2, y2, color) {
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) set(x, y, color);
}

function ellipse(cx, cy, rx, ry, color) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (((x - cx) ** 2) / (rx ** 2) + ((y - cy) ** 2) / (ry ** 2) <= 1) set(x, y, color);
    }
  }
}

function polygon(points, color) {
  const minX = Math.floor(Math.min(...points.map(([x]) => x)));
  const maxX = Math.ceil(Math.max(...points.map(([x]) => x)));
  const minY = Math.floor(Math.min(...points.map(([, y]) => y)));
  const maxY = Math.ceil(Math.max(...points.map(([, y]) => y)));
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if ((yi > y + 0.5) !== (yj > y + 0.5)
        && x + 0.5 < (xj - xi) * (y + 0.5 - yi) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) set(x, y, color);
  }
}

function thickLine(x1, y1, x2, y2, width, color) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x1 + (x2 - x1) * i / steps);
    const y = Math.round(y1 + (y2 - y1) * i / steps);
    ellipse(x, y, width, width, color);
  }
}

// Framed moonlit stage background.
rect(0, 0, 127, 127, C.ink);
rect(3, 3, 124, 124, C.frame);
rect(5, 5, 122, 122, C.night);
rect(7, 7, 120, 91, C.navy);
rect(7, 39, 120, 91, C.royal);
rect(7, 65, 120, 91, C.cyan);
ellipse(65, 39, 34, 34, C.ice);
ellipse(65, 39, 29, 29, C.white);
ellipse(56, 33, 24, 25, C.pearl);
ellipse(46, 25, 4, 3, C.silver);
ellipse(75, 48, 6, 4, C.silver);
ellipse(59, 58, 3, 2, C.silver);

// Velvet curtains and gold stage trim.
polygon([[6, 6], [27, 6], [22, 28], [27, 52], [19, 75], [24, 91], [6, 91]], C.purple);
polygon([[121, 6], [101, 6], [106, 28], [101, 52], [109, 75], [104, 91], [121, 91]], C.purple);
polygon([[8, 8], [16, 8], [14, 31], [18, 49], [12, 70], [15, 89], [8, 89]], C.lavender);
polygon([[119, 8], [112, 8], [114, 31], [110, 49], [116, 70], [113, 89], [119, 89]], C.lavender);
rect(5, 91, 122, 95, C.gold);
rect(7, 96, 120, 122, C.night);
for (let y = 98; y <= 120; y += 7) {
  thickLine(8, y, 38, y - 2, 1, C.aqua);
  thickLine(43, y - 2, 76, y + 1, 1, C.ice);
  thickLine(81, y + 1, 119, y - 2, 1, C.aqua);
}
for (const [x, y] of [[31, 13], [91, 17], [23, 38], [106, 43], [34, 61], [96, 65]]) {
  set(x, y, C.white); set(x - 1, y, C.ice); set(x + 1, y, C.ice); set(x, y - 1, C.ice); set(x, y + 1, C.ice);
}

// Long flowing hair behind the figure.
polygon([[40, 51], [27, 60], [20, 77], [9, 87], [25, 90], [13, 105], [43, 94], [52, 71]], C.ink);
polygon([[88, 49], [102, 59], [111, 73], [121, 81], [107, 88], [119, 101], [89, 93], [77, 69]], C.ink);
polygon([[40, 54], [29, 62], [24, 77], [14, 86], [33, 84], [20, 99], [45, 90], [53, 69]], C.ice);
polygon([[87, 52], [99, 61], [105, 74], [116, 81], [98, 83], [112, 96], [86, 89], [76, 68]], C.aqua);
polygon([[36, 60], [29, 70], [31, 81], [22, 91], [42, 84], [48, 68]], C.white);
polygon([[92, 59], [100, 69], [98, 80], [108, 89], [88, 83], [81, 67]], C.white);

// Tilted crown-like top hat with feather and Hydro ornaments.
polygon([[47, 29], [60, 19], [88, 22], [98, 34], [91, 40], [57, 38]], C.ink);
polygon([[54, 28], [62, 8], [84, 10], [92, 31]], C.ink);
polygon([[58, 28], [64, 11], [81, 13], [87, 31]], C.navy);
polygon([[59, 23], [86, 25], [88, 31], [57, 29]], C.royal);
polygon([[49, 30], [92, 32], [96, 35], [90, 38], [56, 36]], C.purple);
polygon([[66, 12], [69, 6], [72, 13], [76, 6], [80, 14], [82, 24], [64, 22]], C.gold);
ellipse(73, 25, 3, 4, C.cyan);
polygon([[88, 26], [99, 12], [96, 31]], C.white);
polygon([[91, 26], [103, 17], [97, 32]], C.ice);

// Bobbed white hair, face, and recognizable bright blue eyes.
ellipse(64, 49, 26, 24, C.ink);
ellipse(64, 52, 19, 18, C.skin);
ellipse(43, 53, 4, 7, C.skin);
ellipse(85, 53, 4, 7, C.skin);
polygon([[40, 45], [45, 34], [57, 28], [71, 29], [83, 36], [89, 47], [82, 44], [79, 56], [72, 43], [68, 58], [61, 42], [54, 57], [50, 43], [44, 51]], C.white);
polygon([[43, 49], [46, 39], [53, 32], [54, 51], [48, 64], [42, 59]], C.silver);
polygon([[77, 32], [85, 39], [87, 55], [80, 66], [77, 52]], C.ice);
polygon([[47, 56], [51, 65], [47, 72], [42, 65]], C.white);
polygon([[81, 55], [87, 64], [82, 72], [77, 64]], C.ice);

// Eyes, lashes, nose and smile.
polygon([[49, 49], [58, 48], [57, 54], [50, 55]], C.ink);
polygon([[70, 48], [79, 49], [78, 55], [71, 54]], C.ink);
ellipse(54, 52, 3, 4, C.aqua);
ellipse(74, 52, 3, 4, C.royal);
set(53, 50, C.white); set(73, 50, C.white);
set(63, 56, C.blush);
rect(58, 60, 69, 61, C.blush);
rect(61, 62, 66, 63, C.white);
rect(47, 57, 49, 58, C.blush);
rect(79, 57, 81, 58, C.blush);

// Alternate outfit: off-shoulder Fontaine ballroom gown.
polygon([[48, 67], [38, 71], [28, 83], [20, 106], [36, 122], [92, 122], [108, 106], [100, 83], [90, 71], [79, 67]], C.ink);
polygon([[49, 69], [39, 74], [33, 88], [29, 108], [40, 120], [88, 120], [99, 108], [95, 88], [89, 74], [78, 69]], C.navy);
polygon([[42, 74], [49, 68], [57, 72], [64, 81], [71, 72], [79, 68], [87, 74], [82, 87], [46, 87]], C.white);
polygon([[48, 78], [57, 72], [64, 82], [71, 72], [80, 78], [76, 105], [52, 105]], C.royal);
polygon([[36, 89], [50, 95], [52, 120], [36, 120], [28, 108]], C.purple);
polygon([[92, 89], [78, 95], [76, 120], [92, 120], [100, 108]], C.purple);
polygon([[52, 103], [64, 111], [76, 103], [84, 121], [44, 121]], C.white);
polygon([[57, 105], [64, 111], [71, 105], [75, 121], [53, 121]], C.ice);

// Water-drop jewel, pearls, and gold gown filigree.
ellipse(64, 78, 6, 7, C.gold);
ellipse(64, 78, 4, 5, C.cyan);
set(63, 76, C.white);
for (const [x, y] of [[45, 73], [83, 73], [43, 84], [85, 84], [48, 98], [80, 98]]) ellipse(x, y, 2, 2, C.gold);
thickLine(42, 89, 55, 99, 1, C.paleGold);
thickLine(86, 89, 73, 99, 1, C.paleGold);

// Raised gloved hand and a slim ceremonial cane create a new pose.
polygon([[88, 73], [99, 66], [108, 55], [113, 58], [105, 73], [96, 82]], C.ink);
polygon([[92, 75], [100, 68], [108, 58], [111, 60], [104, 72], [97, 80]], C.white);
polygon([[106, 56], [110, 48], [113, 50], [112, 58]], C.skin);
polygon([[108, 50], [111, 43], [113, 51], [116, 46], [114, 55]], C.skin);
thickLine(31, 76, 18, 116, 2, C.ink);
thickLine(31, 76, 18, 116, 1, C.gold);
ellipse(32, 73, 5, 5, C.cyan);
ellipse(32, 73, 3, 3, C.white);

function compressedOperations() {
  const rectangles = [];
  const used = Array.from({ length: H }, () => Array(W).fill(false));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const color = pixels[y][x];
    if (!color || used[y][x]) continue;
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
    from: { x: 480, y: 220 - r.y2, z: 98 + r.x1 },
    to: { x: 480, y: 220 - r.y1, z: 98 + r.x2 },
    block: r.color.block,
  }));
}

async function writePreview() {
  const png = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = (pixels[y][x] ?? C.ink).rgb;
    const offset = (y * W + x) * 4;
    png.data[offset] = r;
    png.data[offset + 1] = g;
    png.data[offset + 2] = b;
    png.data[offset + 3] = 255;
  }
  await mkdir("output", { recursive: true });
  await writeFile("output/furina-fanart-v2.png", PNG.sync.write(png));
}

await writePreview();
const operations = compressedOperations();
const chunks = [];
for (let index = 0; index < operations.length; index += 220) chunks.push(operations.slice(index, index + 220));

if (!process.argv.includes("--build")) {
  console.log(JSON.stringify({ width: W, height: H, blocks: W * H, operationCount: operations.length, chunks: chunks.length, preview: "output/furina-fanart-v2.png" }, null, 2));
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
        label: `Furina moonlit fanart ${index + 1}/${chunks.length}`,
        projectId: "furina-fanart-v2",
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
