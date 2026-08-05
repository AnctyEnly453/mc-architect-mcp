import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile("D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8"));
const operations = [
  { block: "minecraft:air", from: { x: 766, y: 194, z: 500 }, to: { x: 794, y: 197, z: 509 } },
  { block: "minecraft:dark_oak_log[axis=x]", from: { x: 768, y: 194, z: 507 }, to: { x: 792, y: 196, z: 509 } },
  { block: "minecraft:dark_oak_log[axis=y]", from: { x: 768, y: 194, z: 506 }, to: { x: 771, y: 197, z: 509 } },
  { block: "minecraft:dark_oak_log[axis=y]", from: { x: 789, y: 194, z: 506 }, to: { x: 792, y: 197, z: 509 } },
  { block: "minecraft:gold_block", from: { x: 776, y: 194, z: 508 }, to: { x: 784, y: 195, z: 509 } },
];
const apply = process.argv.includes("--apply");
const response = await fetch(`http://127.0.0.1:${config.port}/v1/apply`, {
  method: "POST",
  headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ operations, label: "Meridian Gate central portal plaque v6", projectId: "forbidden-city-wumen-facade-v5", dryRun: !apply }),
});
const result = await response.json();
console.log(JSON.stringify({ apply, status: response.status, result }, null, 2));
if (!response.ok || (!apply && !result.canApply)) process.exitCode = 1;
