import { readFile } from "node:fs/promises";

const PROJECT_ID = "forbidden-city-wumen-v4-detail";
const operations = [];
const add = (block, x1, y1, z1, x2, y2, z2) => operations.push({
  block,
  from: { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2) },
  to: { x: Math.max(x1, x2), y: Math.max(y1, y2), z: Math.max(z1, z2) },
});

// Two side rooms: ceremonial duty rooms with a clear east-west circulation band.
for (const room of [{ x1: 746, x2: 764 }, { x1: 796, x2: 814 }]) {
  const cx = Math.floor((room.x1 + room.x2) / 2);
  add("minecraft:red_carpet", cx - 2, 169, 481, cx + 2, 169, 489);

  // South reception dais, writing table, chairs and storage.
  add("minecraft:polished_andesite", cx - 5, 169, 491, cx + 5, 169, 495);
  add("minecraft:red_carpet", cx - 4, 170, 492, cx + 4, 170, 495);
  add("minecraft:dark_oak_fence", cx - 3, 170, 493, cx - 3, 170, 494);
  add("minecraft:dark_oak_fence", cx + 3, 170, 493, cx + 3, 170, 494);
  add("minecraft:dark_oak_slab[type=top,waterlogged=false]", cx - 4, 171, 493, cx + 4, 171, 494);
  add("minecraft:dark_oak_stairs[facing=south,half=bottom,shape=straight,waterlogged=false]", cx - 2, 170, 491, cx + 2, 170, 491);
  add("minecraft:bookshelf", room.x1 + 1, 169, 493, room.x1 + 2, 173, 495);
  add("minecraft:bookshelf", room.x2 - 2, 169, 493, room.x2 - 1, 173, 495);

  // A low timber screen separates the stair side without closing the room.
  add("minecraft:dark_oak_log[axis=y]", room.x1 + 3, 169, 476, room.x1 + 3, 174, 476);
  add("minecraft:dark_oak_log[axis=y]", room.x2 - 3, 169, 476, room.x2 - 3, 174, 476);
  add("minecraft:yellow_stained_glass", room.x1 + 4, 171, 476, cx - 3, 173, 476);
  add("minecraft:yellow_stained_glass", cx + 3, 171, 476, room.x2 - 4, 173, 476);
  add("minecraft:dark_oak_log[axis=x]", room.x1 + 3, 175, 476, room.x2 - 3, 175, 476);

  // Symmetric warm hanging lights over the furnished zone.
  for (const x of [cx - 5, cx + 5]) {
    add("minecraft:dark_oak_fence", x, 177, 492, x, 182, 492);
    add("minecraft:lantern[hanging=true,waterlogged=false]", x, 176, 492, x, 176, 492);
  }
}

const solidBays = [[694, 717], [743, 767], [793, 817], [843, 866]];
for (const [x1, x2] of solidBays) {
  add("minecraft:polished_andesite", x1, 174, 508, x2, 176, 509);
  add("minecraft:red_terracotta", x1 + 2, 177, 509, x2 - 2, 189, 509);
  add("minecraft:dark_oak_log[axis=x]", x1, 190, 508, x2, 192, 509);
  add("minecraft:gold_block", x1 + 2, 193, 509, x2 - 2, 193, 509);
  for (let x = x1; x <= x2; x += 8) {
    add("minecraft:dark_oak_log[axis=y]", x, 174, 508, Math.min(x + 1, x2), 193, 509);
    add("minecraft:dark_oak_stairs[facing=south,half=top,shape=straight,waterlogged=false]", x, 194, 509, Math.min(x + 1, x2), 194, 509);
  }
  add("minecraft:dark_oak_log[axis=y]", x2 - 1, 174, 508, x2, 193, 509);
}

// Restrained lattice window panels only on the two occupied side-room bays.
for (const [x1, x2] of [[743, 767], [793, 817]]) {
  for (const cx of [x1 + 6, x1 + 15]) {
    add("minecraft:black_stained_glass", cx - 2, 179, 509, cx + 2, 185, 509);
    add("minecraft:dark_oak_log[axis=y]", cx - 3, 178, 509, cx - 2, 186, 509);
    add("minecraft:dark_oak_log[axis=y]", cx + 2, 178, 509, cx + 3, 186, 509);
    add("minecraft:dark_oak_log[axis=x]", cx - 3, 178, 509, cx + 3, 179, 509);
    add("minecraft:dark_oak_log[axis=x]", cx - 3, 185, 509, cx + 3, 186, 509);
    add("minecraft:dark_oak_log[axis=y]", cx, 179, 509, cx, 185, 509);
  }
}

// Three portal frames: dark timber structure with only a narrow gold highlight.
for (const [x1, x2] of [[718, 742], [768, 792], [818, 842]]) {
  add("minecraft:dark_oak_log[axis=y]", x1, 174, 508, x1 + 1, 188, 509);
  add("minecraft:dark_oak_log[axis=y]", x2 - 1, 174, 508, x2, 188, 509);
  add("minecraft:dark_oak_log[axis=x]", x1, 187, 508, x2, 189, 509);
  add("minecraft:gold_block", x1 + 2, 190, 509, x2 - 2, 190, 509);
}

const config = JSON.parse(await readFile("D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8"));
const apply = process.argv.includes("--apply");
const response = await fetch(`http://127.0.0.1:${config.port}/v1/apply`, {
  method: "POST",
  headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ operations, label: "Meridian Gate rooms and south facade v4", projectId: PROJECT_ID, dryRun: !apply }),
});
const result = await response.json();
console.log(JSON.stringify({ apply, operationCount: operations.length, status: response.status, result }, null, 2));
if (!response.ok || (!apply && !result.canApply)) process.exitCode = 1;
