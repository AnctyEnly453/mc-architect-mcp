import { readFile } from "node:fs/promises";

const operations = [];
const PROJECT_ID = "forbidden-city-wumen-v2";
const skipClear = process.argv.includes("--skip-clear");
const add = (block, x1, y1, z1, x2, y2, z2) => operations.push({
  block,
  from: { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2) },
  to: { x: Math.max(x1, x2), y: Math.max(y1, y2), z: Math.max(z1, z2) },
});

const passageRanges = [[718, 742], [768, 792], [818, 842]];

// Remove only the existing Meridian Gate body; split the large clear so every
// operation remains below the transaction block limit. The Y=168 foundation remains.
if (!skipClear) {
  for (let x = 694; x <= 866; x += 14) {
    add("minecraft:air", x, 169, 447, Math.min(866, x + 13), 238, 509);
  }
}

// Two-tier stone-and-marble podium.
add("minecraft:stone_bricks", 694, 169, 447, 866, 170, 509);
add("minecraft:quartz_block", 699, 171, 452, 861, 173, 504);
add("minecraft:polished_andesite", 704, 174, 457, 856, 174, 499);

// Main red structural shell, hollowed deliberately as occupied space.
add("minecraft:red_concrete", 704, 175, 457, 856, 197, 499);
add("minecraft:air", 707, 175, 460, 853, 196, 496);

// Restore the south palace wall where the gatehouse meets it.
add("minecraft:red_concrete", 694, 174, 500, 866, 190, 508);
add("minecraft:yellow_terracotta", 694, 191, 500, 866, 193, 508);

// Three ground-level passages, all sharing the same walkable datum at Y=168.
for (const [x1, x2] of passageRanges) {
  add("minecraft:air", x1, 169, 447, x2, 183, 509);
  add(x1 === 768 ? "minecraft:polished_andesite" : "minecraft:smooth_stone", x1, 168, 447, x2, 168, 509);
  // White stone skirting and red passage lining.
  add("minecraft:quartz_block", x1, 169, 457, x1 + 1, 171, 499);
  add("minecraft:quartz_block", x2 - 1, 169, 457, x2, 171, 499);
  add("minecraft:red_concrete", x1, 172, 457, x1 + 1, 182, 499);
  add("minecraft:red_concrete", x2 - 1, 172, 457, x2, 182, 499);
  add("minecraft:dark_oak_planks", x1, 183, 457, x2, 183, 499);
  for (const z of [462, 474, 486, 496]) {
    add("minecraft:dark_oak_log[axis=x]", x1, 181, z, x2, 183, z + 1);
    add("minecraft:gold_block", x1 + 2, 180, z, x2 - 2, 180, z + 1);
    add("minecraft:sea_lantern", Math.round((x1 + x2) / 2) - 2, 181, z,
      Math.round((x1 + x2) / 2) + 2, 182, z + 1);
  }
  for (const z of [460, 470, 480, 490, 498]) {
    add("minecraft:sea_lantern", x1 + 1, 176, z, x1 + 1, 178, z + 1);
    add("minecraft:sea_lantern", x2 - 1, 176, z, x2 - 1, 178, z + 1);
  }
}

// Four separating walls define two real ground-floor side rooms.
// The podium is exterior structure only; carve its interior down to the shared
// Y=168 floor so the first stair steps have real player headroom.
add("minecraft:air", 746, 169, 460, 764, 196, 496);
add("minecraft:air", 796, 169, 460, 814, 196, 496);

for (const [x1, x2] of [[743, 745], [765, 767], [793, 795], [815, 817]]) {
  add("minecraft:red_concrete", x1, 169, 457, x2, 183, 499);
  // Doorway aligned with the passage floor, not with the raised podium.
  add("minecraft:air", x1, 169, 483, x2, 177, 489);
  add("minecraft:gold_block", x1, 178, 482, x2, 180, 490);
  add("minecraft:gold_block", x1, 169, 482, x2, 177, 482);
  add("minecraft:gold_block", x1, 169, 490, x2, 177, 490);
}

// Occupied room floors and restrained interior column rhythm.
for (const [x1, x2] of [[746, 764], [796, 814]]) {
  add("minecraft:dark_oak_planks", x1, 168, 460, x2, 168, 496);
  add("minecraft:red_carpet", x1 + 4, 169, 481, x2 - 4, 169, 495);
  for (const z of [462, 478, 494]) {
    add("minecraft:red_concrete", x1, 169, z, x1 + 1, 182, z + 1);
    add("minecraft:red_concrete", x2 - 1, 169, z, x2, 182, z + 1);
    add("minecraft:sea_lantern", x1 + 2, 176, z, x1 + 2, 178, z + 1);
    add("minecraft:sea_lantern", x2 - 2, 176, z, x2 - 2, 178, z + 1);
  }
}

// A continuous second floor, then two reserved stairwells cut before railings are added.
add("minecraft:dark_oak_planks", 707, 184, 460, 853, 184, 496);
for (const [x1, x2] of [[746, 751], [809, 814]]) {
  add("minecraft:air", x1, 184, 460, x2, 185, 475);
}

// Straight ceremonial stairs: 15 rises, a real landing, and a full-height open shaft.
for (const stair of [{ x1: 746, x2: 750 }, { x1: 810, x2: 814 }]) {
  for (let i = 0; i < 15; i++) {
    // Reserve the player's clearance envelope after all nearby columns and
    // floor slabs have been generated, then place the stair itself.
    add("minecraft:air", stair.x1, 170 + i, 461 + i, stair.x2, 171 + i, 461 + i);
    add("minecraft:quartz_stairs[facing=south,half=bottom,shape=straight,waterlogged=false]",
      stair.x1, 169 + i, 461 + i, stair.x2, 169 + i, 461 + i);
  }
  add("minecraft:quartz_block", stair.x1, 184, 476, stair.x2 + 4, 184, 481);
  // Guard only the sides and lower end; the upper landing remains unobstructed.
  add("minecraft:dark_oak_fence", stair.x1 - 1, 185, 460, stair.x1 - 1, 187, 475);
  add("minecraft:dark_oak_fence", stair.x2 + 1, 185, 460, stair.x2 + 1, 187, 475);
  add("minecraft:dark_oak_fence", stair.x1 - 1, 185, 459, stair.x2 + 1, 187, 459);
}

// Second-floor gallery: open plan, perimeter columns, lamps and central aisle.
add("minecraft:red_carpet", 772, 185, 461, 788, 185, 495);
for (const x of [710, 726, 744, 762, 780, 798, 816, 834, 850]) {
  add("minecraft:red_concrete", x, 185, 460, x + 2, 196, 462);
  add("minecraft:red_concrete", x, 185, 494, x + 2, 196, 496);
  add("minecraft:sea_lantern", x, 190, 463, x + 2, 192, 463);
  add("minecraft:sea_lantern", x, 190, 493, x + 2, 192, 493);
}
for (const z of [466, 478, 490]) {
  add("minecraft:dark_oak_log[axis=x]", 707, 195, z, 853, 197, z + 1);
  add("minecraft:gold_block", 712, 194, z, 848, 194, z + 1);
  for (const x of [730, 780, 830]) add("minecraft:sea_lantern", x - 2, 195, z, x + 2, 196, z + 2);
}

// Ground and upper windows; each bay is separated by red posts.
for (const x of [710, 728, 746, 798, 816, 834]) {
  add("minecraft:cyan_stained_glass", x, 174, 457, x + 10, 180, 458);
  add("minecraft:cyan_stained_glass", x, 187, 457, x + 10, 193, 458);
  add("minecraft:cyan_stained_glass", x, 174, 498, x + 10, 180, 499);
  add("minecraft:cyan_stained_glass", x, 187, 498, x + 10, 193, 499);
}
for (const x of [708, 726, 744, 762, 780, 798, 816, 834, 852]) {
  add("minecraft:red_concrete", x, 173, 456, x + 2, 197, 459);
  add("minecraft:red_concrete", x, 173, 497, x + 2, 197, 500);
}

// Gold-framed north and south passage portals.
for (const [x1, x2] of passageRanges) {
  for (const z of [456, 500]) {
    add("minecraft:gold_block", x1 - 2, 169, z, x1, 184, z + 1);
    add("minecraft:gold_block", x2, 169, z, x2 + 2, 184, z + 1);
    add("minecraft:gold_block", x1 - 2, 184, z, x2 + 2, 186, z + 1);
  }
}

// Lower eave and stepped hip roof.
add("minecraft:dark_oak_planks", 700, 197, 453, 860, 198, 503);
add("minecraft:orange_terracotta", 698, 199, 451, 862, 200, 505);
add("minecraft:gold_block", 700, 201, 453, 860, 201, 503);
for (let i = 0; i < 10; i++) {
  add(i % 3 === 0 ? "minecraft:gold_block" : "minecraft:yellow_terracotta",
    700 + i * 2, 202 + i, 453 + i, 860 - i * 2, 202 + i, 503 - i);
}

// Upper gate tower with windows on all sides.
add("minecraft:dark_oak_planks", 730, 212, 466, 830, 212, 490);
add("minecraft:red_concrete", 730, 213, 466, 830, 222, 490);
add("minecraft:air", 733, 214, 469, 827, 221, 487);
for (const x of [734, 750, 766, 782, 798, 814]) {
  add("minecraft:cyan_stained_glass", x, 215, 466, x + 10, 220, 467);
  add("minecraft:cyan_stained_glass", x, 215, 489, x + 10, 220, 490);
  add("minecraft:red_concrete", x - 2, 213, 465, x, 222, 468);
  add("minecraft:red_concrete", x - 2, 213, 488, x, 222, 491);
}
add("minecraft:sea_lantern", 748, 219, 478, 752, 221, 482);
add("minecraft:sea_lantern", 778, 219, 478, 782, 221, 482);
add("minecraft:sea_lantern", 808, 219, 478, 812, 221, 482);

// Upper eave and roof ridge.
add("minecraft:orange_terracotta", 724, 223, 460, 836, 224, 496);
add("minecraft:gold_block", 726, 225, 462, 834, 225, 494);
for (let i = 0; i < 8; i++) {
  add(i % 3 === 0 ? "minecraft:gold_block" : "minecraft:yellow_terracotta",
    728 + i * 2, 226 + i, 462 + i, 832 - i * 2, 226 + i, 494 - i);
}
add("minecraft:gold_block", 744, 234, 477, 816, 236, 479);

// Exterior podium lamps and sparse balustrade posts, leaving all three portals clear.
for (const x of [700, 708, 752, 760, 800, 808, 852, 860]) {
  add("minecraft:diorite_wall", x, 174, 452, x, 178, 452);
  add("minecraft:diorite_wall", x, 174, 504, x, 178, 504);
  add("minecraft:sea_lantern", x - 1, 179, 451, x + 1, 181, 453);
  add("minecraft:sea_lantern", x - 1, 179, 503, x + 1, 181, 505);
}

const volume = (op) => (op.to.x - op.from.x + 1) * (op.to.y - op.from.y + 1) * (op.to.z - op.from.z + 1);
const chunks = [];
let currentChunk = [];
let currentVolume = 0;
for (const operation of operations) {
  const operationVolume = volume(operation);
  if (currentChunk.length && (currentChunk.length >= 160 || currentVolume + operationVolume > 70000)) {
    chunks.push(currentChunk);
    currentChunk = [];
    currentVolume = 0;
  }
  currentChunk.push(operation);
  currentVolume += operationVolume;
}
if (currentChunk.length) chunks.push(currentChunk);
const config = JSON.parse(await readFile("D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8"));
const apply = process.argv.includes("--apply");
const results = [];
for (let index = 0; index < chunks.length; index++) {
  const response = await fetch(`http://127.0.0.1:${config.port}/v1/apply`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      operations: chunks[index],
      label: `Forbidden City Meridian Gate v2 ${index + 1}/${chunks.length}`,
      projectId: PROJECT_ID,
      dryRun: !apply,
    }),
  });
  const result = await response.json();
  results.push({ part: index + 1, operationCount: chunks[index].length, status: response.status, result });
  if (!response.ok || (!apply && !result.canApply)) break;
}

console.log(JSON.stringify({ apply, operationCount: operations.length, chunks: chunks.length, results }, null, 2));
if (results.some((part) => part.status >= 400 || (!apply && !part.result.canApply))) process.exitCode = 1;
