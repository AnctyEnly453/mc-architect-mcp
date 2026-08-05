import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile("D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8"));
const operations = [];
const add = (block, x1, y1, z1, x2, y2, z2) => operations.push({
  block,
  from: { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2) },
  to: { x: Math.max(x1, x2), y: Math.max(y1, y2), z: Math.max(z1, z2) },
});

// Remove the continuous front eave only where it crosses the three portals.
for (const [x1, x2] of [[718, 742], [768, 792], [818, 842]]) {
  add("minecraft:air", x1, 185, 510, x2, 187, 511);
}

// Retain short eaves over solid wall bays and give every cut end a visible timber termination.
for (const [x1, x2] of [[694, 717], [743, 767], [793, 817], [843, 866]]) {
  add("minecraft:dark_oak_planks", x1, 185, 510, x2, 187, 511);
  add("minecraft:dark_oak_log[axis=z]", x1, 185, 510, x1 + 1, 187, 511);
  add("minecraft:dark_oak_log[axis=z]", x2 - 1, 185, 510, x2, 187, 511);
  for (const x of [x1 + 5, x2 - 5]) {
    add("minecraft:dark_oak_stairs[facing=south,half=top,shape=straight,waterlogged=false]", x - 1, 184, 510, x + 1, 184, 511);
  }
}

const apply = process.argv.includes("--apply");
const response = await fetch(`http://127.0.0.1:${config.port}/v1/apply`, {
  method: "POST",
  headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ operations, label: "Meridian Gate segmented front eaves v9", projectId: "forbidden-city-wumen-facade-v5", dryRun: !apply }),
});
const result = await response.json();
console.log(JSON.stringify({ apply, status: response.status, result }, null, 2));
if (!response.ok || (!apply && !result.canApply)) process.exitCode = 1;
