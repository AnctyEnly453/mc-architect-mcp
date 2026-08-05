import { readFile } from "node:fs/promises";

const PROJECT_ID = "forbidden-city-wumen-room-doors-v1";
const operations = [];
const add = (block, x1, y1, z1, x2, y2, z2) => operations.push({
  block,
  from: { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2) },
  to: { x: Math.max(x1, x2), y: Math.max(y1, y2), z: Math.max(z1, z2) },
});

const walls = [
  { x1: 743, x2: 745, clear1: 741, clear2: 745, plane: 744 },
  { x1: 765, x2: 767, clear1: 765, clear2: 769, plane: 766 },
  { x1: 793, x2: 795, clear1: 791, clear2: 795, plane: 794 },
  { x1: 815, x2: 817, clear1: 815, clear2: 819, plane: 816 },
];

for (const wall of walls) {
  // Rebuild the side wall around a hall-scaled 9-wide, 7-high portal.
  add("minecraft:red_concrete", wall.x1, 169, 479, wall.x2, 180, 491);
  add("minecraft:air", wall.clear1, 169, 481, wall.clear2, 175, 489);
  add("minecraft:dark_oak_log[axis=y]", wall.clear1, 169, 480, wall.clear2, 177, 480);
  add("minecraft:dark_oak_log[axis=y]", wall.clear1, 169, 490, wall.clear2, 177, 490);
  add("minecraft:dark_oak_log[axis=z]", wall.clear1, 176, 481, wall.clear2, 177, 489);
  // Keep the central three cells as unobstructed circulation; the door leaf is decorative/open.
  add("minecraft:dark_oak_door[facing=east,half=lower,hinge=left,open=true,powered=false]", wall.plane, 169, 481, wall.plane, 169, 481);
  add("minecraft:dark_oak_door[facing=east,half=upper,hinge=left,open=true,powered=false]", wall.plane, 170, 481, wall.plane, 170, 481);
}

const config = JSON.parse(await readFile("D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8"));
const apply = process.argv.includes("--apply");
const response = await fetch(`http://127.0.0.1:${config.port}/v1/apply`, {
  method: "POST",
  headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ operations, label: "Meridian Gate side-room double doors v1", projectId: PROJECT_ID, dryRun: !apply }),
});
const result = await response.json();
console.log(JSON.stringify({ apply, operationCount: operations.length, status: response.status, result }, null, 2));
if (!response.ok || (!apply && !result.canApply)) process.exitCode = 1;
