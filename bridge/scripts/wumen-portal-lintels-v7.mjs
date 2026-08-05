import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile("D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8"));
const operations = [];
for (const [x1, x2] of [[718, 742], [818, 842]]) {
  operations.push(
    { block: "minecraft:air", from: { x: x1 + 3, y: 188, z: 507 }, to: { x: x2 - 3, y: 190, z: 509 } },
    { block: "minecraft:dark_oak_log[axis=x]", from: { x: x1, y: 191, z: 507 }, to: { x: x2, y: 193, z: 509 } },
  );
}

const apply = process.argv.includes("--apply");
const response = await fetch(`http://127.0.0.1:${config.port}/v1/apply`, {
  method: "POST",
  headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ operations, label: "Meridian Gate raised side lintels v7", projectId: "forbidden-city-wumen-facade-v5", dryRun: !apply }),
});
const result = await response.json();
console.log(JSON.stringify({ apply, status: response.status, result }, null, 2));
if (!response.ok || (!apply && !result.canApply)) process.exitCode = 1;
