import { readFile } from "node:fs/promises";

const W = 48;
const H = 64;
const pixels = Array.from({ length: H }, () => Array(W).fill(null));

const C = {
  outline: "minecraft:black_concrete",
  navy: "minecraft:blue_concrete",
  deep: "minecraft:blue_terracotta",
  royal: "minecraft:lapis_block",
  cyan: "minecraft:cyan_concrete",
  paleBlue: "minecraft:light_blue_concrete",
  white: "minecraft:white_concrete",
  shadow: "minecraft:light_gray_concrete",
  skin: "minecraft:white_terracotta",
  blush: "minecraft:pink_terracotta",
  eye: "minecraft:light_blue_wool",
  gold: "minecraft:yellow_concrete",
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

// Back hair and long ocean-blue tails.
polygon([[7, 17], [12, 11], [17, 16], [15, 29], [12, 42], [7, 52], [4, 48], [7, 35]], C.outline);
polygon([[41, 17], [36, 11], [31, 16], [33, 29], [36, 42], [41, 52], [44, 48], [41, 35]], C.outline);
polygon([[9, 18], [13, 14], [15, 18], [13, 29], [10, 41], [7, 48], [7, 39]], C.paleBlue);
polygon([[39, 18], [35, 14], [33, 18], [35, 29], [38, 41], [41, 48], [41, 39]], C.paleBlue);
polygon([[10, 22], [12, 20], [11, 38], [8, 45], [9, 35]], C.white);
polygon([[38, 22], [36, 20], [37, 38], [40, 45], [39, 35]], C.cyan);

// Head outline, face, ears, and bobbed white hair.
ellipse(24, 20, 13, 14, C.outline);
ellipse(24, 21, 10, 11, C.skin);
rect(13, 20, 15, 24, C.skin);
rect(33, 20, 35, 24, C.skin);
polygon([[13, 13], [17, 9], [25, 8], [34, 13], [33, 20], [29, 16], [27, 22], [24, 15], [21, 22], [19, 16], [15, 21]], C.white);
polygon([[29, 10], [34, 14], [33, 26], [29, 31], [31, 20]], C.paleBlue);
polygon([[14, 15], [18, 11], [18, 27], [15, 31]], C.shadow);
rect(17, 30, 20, 34, C.white);
rect(28, 30, 31, 34, C.paleBlue);

// Blue eyes and small expression.
rect(18, 21, 21, 23, C.outline);
rect(27, 21, 30, 23, C.outline);
rect(19, 21, 20, 22, C.eye);
rect(28, 21, 29, 22, C.eye);
set(20, 21, C.white);
set(29, 21, C.white);
set(17, 26, C.blush);
set(31, 26, C.blush);
rect(23, 27, 25, 27, C.outline);

// Furina's dark top hat, pale crest, and gold accent.
rect(10, 8, 38, 11, C.outline);
rect(12, 8, 36, 9, C.navy);
polygon([[15, 8], [17, 1], [31, 1], [34, 8]], C.outline);
polygon([[18, 7], [19, 3], [30, 3], [31, 7]], C.navy);
rect(18, 6, 31, 7, C.royal);
polygon([[22, 3], [24, 0], [26, 3], [29, 1], [28, 6], [21, 6], [20, 1]], C.white);
rect(23, 5, 26, 6, C.gold);

// Coat silhouette and sleeves.
polygon([[16, 32], [11, 35], [10, 46], [15, 50], [18, 47], [30, 47], [33, 50], [38, 46], [37, 35], [32, 32]], C.outline);
polygon([[17, 33], [13, 36], [13, 45], [17, 47], [20, 44], [28, 44], [31, 47], [35, 45], [35, 36], [31, 33]], C.navy);
polygon([[10, 35], [6, 40], [5, 48], [9, 50], [13, 44], [14, 36]], C.outline);
polygon([[38, 35], [42, 40], [43, 48], [39, 50], [35, 44], [34, 36]], C.outline);
polygon([[11, 37], [8, 41], [8, 47], [10, 47], [13, 43], [14, 37]], C.royal);
polygon([[37, 37], [40, 41], [40, 47], [38, 47], [35, 43], [34, 37]], C.royal);

// White ruffles, blue waistcoat, coat tails, and hydro jewel.
polygon([[20, 32], [24, 36], [28, 32], [30, 39], [27, 44], [21, 44], [18, 39]], C.white);
polygon([[21, 34], [24, 37], [27, 34], [28, 42], [20, 42]], C.deep);
rect(23, 36, 25, 38, C.cyan);
set(24, 37, C.eye);
rect(17, 43, 31, 46, C.royal);
rect(19, 44, 29, 45, C.white);
rect(22, 43, 26, 44, C.gold);
polygon([[14, 45], [20, 45], [18, 56], [13, 51]], C.navy);
polygon([[34, 45], [28, 45], [30, 56], [35, 51]], C.navy);
rect(11, 48, 14, 51, C.white);
rect(34, 48, 37, 51, C.white);

// Shorts, asymmetric stockings, and heeled boots.
polygon([[18, 46], [24, 46], [23, 51], [17, 51]], C.outline);
polygon([[24, 46], [30, 46], [31, 51], [24, 51]], C.outline);
rect(19, 47, 23, 49, C.white);
rect(25, 47, 29, 49, C.white);
polygon([[18, 50], [23, 50], [22, 61], [17, 61]], C.skin);
polygon([[25, 50], [30, 50], [31, 61], [26, 61]], C.deep);
rect(17, 55, 22, 60, C.white);
rect(17, 57, 22, 58, C.paleBlue);
polygon([[16, 59], [22, 59], [23, 63], [15, 63]], C.outline);
polygon([[26, 58], [31, 58], [33, 63], [25, 63]], C.outline);
rect(17, 59, 21, 61, C.navy);
rect(27, 59, 30, 61, C.navy);

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
    from: { x: 324 + r.x1, y: 169 - r.y2, z: 158 },
    to: { x: 324 + r.x2, y: 169 - r.y1, z: 158 },
    block: r.color,
  }));
}

const config = JSON.parse(await readFile(
  "D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8",
));
const operations = compressedOperations();
const chunks = [];
for (let index = 0; index < operations.length; index += 200) chunks.push(operations.slice(index, index + 200));
const apply = process.argv.includes("--apply");
const results = [];
for (let index = 0; index < chunks.length; index++) {
  const response = await fetch(`http://127.0.0.1:${config.port}/v1/apply`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      operations: chunks[index],
      label: `Furina sky pixel art ${index + 1}/${chunks.length}`,
      projectId: "furina-pixel-art",
      dryRun: !apply,
    }),
  });
  const result = await response.json();
  results.push({ part: index + 1, operationCount: chunks[index].length, status: response.status, result });
  if (!response.ok || (!apply && !result.canApply)) break;
}
console.log(JSON.stringify({ operationCount: operations.length, parts: results }, null, 2));
if (results.some((part) => part.status >= 400 || (!apply && !part.result.canApply))) process.exitCode = 1;
