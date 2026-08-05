import { readFile } from "node:fs/promises";

const operations = [];
const operationGroups = new Map();
let activeGroup = "unassigned";
const PROJECT_ID = "forbidden-city-grand-complex";
const add = (block, x1, y1, z1, x2, y2, z2) => {
  const operation = {
    block,
    from: { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2) },
    to: { x: Math.max(x1, x2), y: Math.max(y1, y2), z: Math.max(z1, z2) },
  };
  operations.push(operation);
  if (!operationGroups.has(activeGroup)) operationGroups.set(activeGroup, []);
  operationGroups.get(activeGroup).push(operation);
};

function furnishHall(cx, cz, width, depth, bodyHeight, roofHeight, tiers, doubleEave = false, throne = false) {
  const previousGroup = activeGroup;
  activeGroup = `hall-${cx}-${cz}`;
  const x1 = Math.round(cx - width / 2);
  const x2 = Math.round(cx + width / 2);
  const z1 = Math.round(cz - depth / 2);
  const z2 = Math.round(cz + depth / 2);
  const base = 168 + tiers * 3;
  const ceiling = base + bodyHeight - 2;

  // Replace the solid placeholder slab with a walkable, lit ceremonial interior.
  add("minecraft:air", x1 + 3, base + 1, z1 + 3, x2 - 3, ceiling - 1, z2 - 3);
  add("minecraft:dark_oak_planks", x1 + 3, base + 1, z1 + 3, x2 - 3, base + 1, z2 - 3);
  add("minecraft:red_concrete", x1 + 3, ceiling, z1 + 3, x2 - 3, ceiling, z2 - 3);

  // Gold-edged transverse beams and recessed lantern coffers.
  for (let z = z1 + 6; z <= z2 - 6; z += 10) {
    add("minecraft:dark_oak_log[axis=x]", x1 + 3, ceiling - 1, z, x2 - 3, ceiling + 1, z + 1);
    add("minecraft:gold_block", x1 + 5, ceiling - 2, z, x2 - 5, ceiling - 2, z);
  }
  for (let x = x1 + 8; x <= x2 - 8; x += 14) {
    for (let z = z1 + 8; z <= z2 - 8; z += 14) {
      add("minecraft:sea_lantern", x, ceiling - 1, z, x + 2, ceiling, z + 2);
      add("minecraft:yellow_stained_glass", x, ceiling - 2, z, x + 2, ceiling - 2, z + 2);
    }
  }

  // Interior red columns, wall lamps, and a clear central aisle.
  for (let x = x1 + 7; x <= x2 - 7; x += 12) {
    add("minecraft:red_concrete", x, base + 2, z1 + 5, x + 1, ceiling - 1, z1 + 6);
    add("minecraft:red_concrete", x, base + 2, z2 - 6, x + 1, ceiling - 1, z2 - 5);
    add("minecraft:sea_lantern", x, base + 7, z1 + 7, x + 1, base + 9, z1 + 7);
    add("minecraft:sea_lantern", x, base + 7, z2 - 7, x + 1, base + 9, z2 - 7);
  }
  add("minecraft:red_carpet", cx - 3, base + 2, z1 + 5, cx + 3, base + 2, z2 - 4);

  if (throne) {
    add("minecraft:gold_block", cx - 9, base + 2, z1 + 7, cx + 9, base + 4, z1 + 16);
    add("minecraft:red_concrete", cx - 6, base + 5, z1 + 9, cx + 6, base + 12, z1 + 13);
    add("minecraft:gold_block", cx - 7, base + 12, z1 + 8, cx + 7, base + 14, z1 + 14);
    add("minecraft:yellow_stained_glass", cx - 3, base + 7, z1 + 8, cx + 3, base + 10, z1 + 8);
  }

  // Break up the sealed red upper storey of double-eave halls with windows and posts.
  if (doubleEave) {
    const ridgeY = base + bodyHeight + 1 + roofHeight + 3;
    const ux1 = x1 + 8;
    const ux2 = x2 - 8;
    const uz1 = z1 + 6;
    const uz2 = z2 - 6;
    add("minecraft:cyan_stained_glass", ux1, ridgeY, uz1, ux2, ridgeY + 4, uz1);
    add("minecraft:cyan_stained_glass", ux1, ridgeY, uz2, ux2, ridgeY + 4, uz2);
    for (let x = ux1; x <= ux2; x += 8) {
      add("minecraft:red_concrete", x, ridgeY - 1, uz1 - 1, x + 1, ridgeY + 6, uz1 + 1);
      add("minecraft:red_concrete", x, ridgeY - 1, uz2 - 1, x + 1, ridgeY + 6, uz2 + 1);
    }
  }
  activeGroup = previousGroup;
}

// Main ceremonial and inner-court halls.
furnishHall(780, 304, 108, 56, 20, 14, 3, true, true);
furnishHall(780, 235, 58, 44, 16, 11, 2, true, false);
furnishHall(780, 171, 92, 50, 18, 12, 2, true, true);
furnishHall(780, 55, 82, 44, 17, 11, 2, true, true);
furnishHall(780, 5, 72, 38, 15, 10, 2, false, false);

// Repeated side halls.
for (const z of [430, 340, 275, 215, 155, 95, 45]) {
  furnishHall(680, z, z > 300 ? 56 : 44, 26, 11, 7, 1);
  furnishHall(880, z, z > 300 ? 56 : 44, 26, 11, 7, 1);
}
for (const x of [650, 710, 850, 910]) {
  furnishHall(x, 300, 38, 52, 11, 7, 1);
  furnishHall(x, 190, 34, 44, 11, 7, 1);
  furnishHall(x, 55, 34, 36, 11, 7, 1);
}

// Remove only tree materials where garden trees intersect side-hall footprints.
const treeCleanupRegions = [
  [643, 176, 323, 677, 194, 337], [883, 176, 323, 917, 194, 337],
  [663, 176, 213, 677, 194, 267], [883, 176, 213, 897, 194, 267],
];

const config = JSON.parse(await readFile("D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8"));
const apply = process.argv.includes("--apply");
const requestedPartOption = process.argv.find((arg) => arg.startsWith("--part="));
const requestedPart = requestedPartOption ? Number(requestedPartOption.split("=")[1]) : null;
const results = [];

const chunks = [];
for (const [group, groupOperations] of operationGroups) {
  for (let index = 0; index < groupOperations.length; index += 180) {
    chunks.push({ group, operations: groupOperations.slice(index, index + 180) });
  }
}
if (process.argv.includes("--manifest")) {
  const manifest = chunks.map((chunkInfo, index) => ({
    part: index + 1,
    group: chunkInfo.group,
    operations: chunkInfo.operations.length,
    bounds: chunkInfo.operations.reduce((bounds, op) => ({
      from: {
        x: Math.min(bounds.from.x, op.from.x), y: Math.min(bounds.from.y, op.from.y), z: Math.min(bounds.from.z, op.from.z),
      },
      to: {
        x: Math.max(bounds.to.x, op.to.x), y: Math.max(bounds.to.y, op.to.y), z: Math.max(bounds.to.z, op.to.z),
      },
    }), { from: { x: Infinity, y: Infinity, z: Infinity }, to: { x: -Infinity, y: -Infinity, z: -Infinity } }),
  }));
  console.log(JSON.stringify({ operationCount: operations.length, manifest }, null, 2));
  process.exit(0);
}

// Detail operations stay grouped by building in manageable transactions.
for (let index = 0; index < chunks.length; index++) {
  const chunkInfo = chunks[index];
  const chunk = chunkInfo.operations;
  const partNumber = index + 1;
  if (requestedPart !== null && requestedPart !== partNumber) continue;
  const response = await fetch(`http://127.0.0.1:${config.port}/v1/apply`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      operations: chunk,
      label: `Forbidden City interior detail ${chunkInfo.group} (${partNumber}/${chunks.length})`,
      projectId: PROJECT_ID,
      dryRun: !apply,
    }),
  });
  const result = await response.json();
  results.push({ kind: "detail", part: partNumber, status: response.status, result });
  if (!response.ok || (!apply && !result.canApply)) break;
}

if (requestedPart === null && results.every((part) => part.status < 400 && (apply || part.result.canApply))) {
  for (let index = 0; index < treeCleanupRegions.length; index++) {
    const [x1, y1, z1, x2, y2, z2] = treeCleanupRegions[index];
    const response = await fetch(`http://127.0.0.1:${config.port}/v1/replace`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: { x: x1, y: y1, z: z1 }, to: { x: x2, y: y2, z: z2 },
        match: ["minecraft:dark_oak_leaves", "minecraft:dark_oak_log"], block: "minecraft:air",
        label: `Forbidden City tree collision cleanup ${index + 1}/4`, projectId: PROJECT_ID, dryRun: !apply,
      }),
    });
    const result = await response.json();
    results.push({ kind: "tree", part: index + 1, status: response.status, result });
  }
}

console.log(JSON.stringify({ apply, operationCount: operations.length, results }, null, 2));
if (results.some((part) => part.status >= 400 || (!apply && part.result.canApply === false))) process.exitCode = 1;
