import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile("D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8"));
const operations = [];
for (const portal of [
  { outer: [721, 739], middle: [722, 738], inner: [724, 736] },
  { outer: [772, 788], middle: [772, 788], inner: [773, 787] },
  { outer: [821, 839], middle: [822, 838], inner: [824, 836] },
]) {
  for (const [range, y1, z1, z2] of [
    [portal.outer, 171, 506, 509],
    [portal.middle, 171, 502, 505],
    [portal.inner, 169, 497, 501],
  ]) {
    operations.push({
      block: "minecraft:air",
      from: { x: range[0], y: y1, z: z1 },
      to: { x: range[1], y: 190, z: z2 },
    });
  }
}

const apply = process.argv.includes("--apply");
const response = await fetch(`http://127.0.0.1:${config.port}/v1/apply`, {
  method: "POST",
  headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ operations, label: "Meridian Gate splayed full-height portals v8b", projectId: "forbidden-city-wumen-facade-v5", dryRun: !apply }),
});
const result = await response.json();
console.log(JSON.stringify({ apply, status: response.status, result }, null, 2));
if (!response.ok || (!apply && !result.canApply)) process.exitCode = 1;
