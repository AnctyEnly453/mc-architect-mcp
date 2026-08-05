import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile("D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8"));
const operations = [];
const add = (block, x1, y1, z1, x2, y2, z2) => operations.push({
  block,
  from: { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2) },
  to: { x: Math.max(x1, x2), y: Math.max(y1, y2), z: Math.max(z1, z2) },
});

for (const [x1, x2] of [[718, 742], [768, 792], [818, 842]]) {
  for (const [p1, p2] of [[x1, x1 + 2], [x2 - 2, x2]]) {
    add("minecraft:stone_bricks", p1 - 1, 169, 504, p2 + 1, 170, 509);
    add("minecraft:polished_andesite", p1, 171, 505, p2, 172, 509);
    add("minecraft:chiseled_stone_bricks", p1, 173, 506, p2, 175, 509);
  }
}

const apply = process.argv.includes("--apply");
const response = await fetch(`http://127.0.0.1:${config.port}/v1/apply`, {
  method: "POST",
  headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ operations, label: "Meridian Gate portal column plinths v7b", projectId: "forbidden-city-wumen-facade-v5", dryRun: !apply }),
});
const result = await response.json();
console.log(JSON.stringify({ apply, status: response.status, result }, null, 2));
if (!response.ok || (!apply && !result.canApply)) process.exitCode = 1;
