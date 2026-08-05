import { readFile, writeFile } from "node:fs/promises";

const PROJECT_ID = "forbidden-city-wumen-v3";
const OUTPUT = "D:/AI WORK/006/output/wumen-entrance-v3-design.json";
const operations = [];
const add = (block, x1, y1, z1, x2, y2, z2) => operations.push({
  phase: "entrance-repair",
  block,
  from: { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2) },
  to: { x: Math.max(x1, x2), y: Math.max(y1, y2), z: Math.max(z1, z2) },
});

const passages = [
  { id: "west", x1: 718, x2: 742, open1: 724, open2: 736, center: 730, floor: "minecraft:smooth_stone" },
  { id: "central", x1: 768, x2: 792, open1: 773, open2: 787, center: 780, floor: "minecraft:polished_andesite" },
  { id: "east", x1: 818, x2: 842, open1: 824, open2: 836, center: 830, floor: "minecraft:smooth_stone" },
];

for (const passage of passages) {
  // Explicit support surface used by both the design model and final idempotent repair.
  add(passage.floor, passage.x1, 168, 455, passage.x2, 168, 501);

  // Remove the later facade grid that invaded the original passage volume.
  for (const [z1, z2] of [[457, 458], [498, 499]]) {
    add("minecraft:air", passage.x1, 169, z1, passage.x2, 180, z2);
    add("minecraft:quartz_block", passage.x1, 169, z1, passage.open1 - 1, 171, z2);
    add("minecraft:quartz_block", passage.open2 + 1, 169, z1, passage.x2, 171, z2);
    add("minecraft:red_concrete", passage.x1, 172, z1, passage.open1 - 1, 180, z2);
    add("minecraft:red_concrete", passage.open2 + 1, 172, z1, passage.x2, 180, z2);
  }
  for (const [z1, z2] of [[456, 459], [497, 500]]) {
    add("minecraft:air", passage.open1, 169, z1, passage.open2, 180, z2);
  }

  // Restore red passage lining where exposed sea-lantern strips created a modern tunnel effect.
  for (const z of [460, 470, 480, 490]) {
    add("minecraft:red_concrete", passage.x1 + 1, 176, z, passage.x1 + 1, 178, z + 1);
    add("minecraft:red_concrete", passage.x2 - 1, 176, z, passage.x2 - 1, 178, z + 1);
  }

  // Replace all fluorescent ceiling panels and broad gold bands with one timber ceiling.
  add("minecraft:air", passage.x1 + 2, 180, 455, passage.x2 - 2, 180, 501);
  add("minecraft:dark_oak_planks", passage.x1 + 2, 181, 455, passage.x2 - 2, 183, 501);

  // Add timber crossbeams and warm lantern rows below the continuous ceiling.
  // Remove the first v3 lamp positions so rerunning this revision is idempotent.
  for (const z of [462, 474, 486, 496]) {
    add("minecraft:air", passage.center - 4, 174, z, passage.center + 4, 180, z);
  }

  for (const z of [460, 470, 480, 490, 498]) {
    // Clear the previous three-column lamp grid before placing the open-axis revision.
    add("minecraft:air", passage.center - 8, 174, z, passage.center + 8, 180, z);
    add("minecraft:dark_oak_log[axis=x]", passage.x1 + 2, 181, z, passage.x2 - 2, 182, z + 1);
    for (const x of [passage.center - 10, passage.center - 4, passage.center + 4, passage.center + 10]) {
      add("minecraft:dark_oak_fence", x, 175, z, x, 180, z);
      add("minecraft:lantern[hanging=true,waterlogged=false]", x, 174, z, x, 174, z);
    }
  }
}

const protectedClearance = passages.flatMap((passage) => [
  {
    name: `${passage.id}-passage-route`,
    from: { x: passage.open1, y: 169, z: 455 },
    to: { x: passage.open2, y: 171, z: 501 },
  },
  {
    name: `${passage.id}-axis-sightline`,
    from: { x: passage.center - 2, y: 169, z: 455 },
    to: { x: passage.center + 2, y: 180, z: 501 },
  },
]);

const routeChecks = passages.map((passage) => ({
  name: `${passage.id}-south-to-north`,
  start: { x: passage.center, y: 169, z: 501 },
  goals: [{ x: passage.center, y: 169, z: 455 }],
}));

const styleChecks = passages.map((passage) => ({
  name: `${passage.id}-ceremonial-passage`,
  from: { x: passage.x1, y: 169, z: 455 },
  to: { x: passage.x2, y: 183, z: 501 },
  forbiddenBlocks: ["minecraft:cyan_stained_glass", "minecraft:sea_lantern"],
  maxShare: { "minecraft:gold_block": 0.03 },
}));

const lightingChecks = passages.map((passage) => ({
  name: `${passage.id}-warm-lighting`,
  from: { x: passage.x1, y: 169, z: 455 },
  to: { x: passage.x2, y: 182, z: 501 },
  minimumSources: 20,
  samplePoints: [460, 480, 500].map((z) => ({ x: passage.center, y: 169, z })),
  maxDistance: 16,
}));

const manifest = {
  name: "forbidden-city-wumen-entrance-v3",
  project: { id: PROJECT_ID, scale: "component", worldId: "PCL-1.21.11", dimension: "minecraft:overworld", revision: 3 },
  bounds: { from: { x: 716, y: 168, z: 455 }, to: { x: 844, y: 183, z: 501 } },
  defaultBlock: "minecraft:air",
  movementProfile: { height: 2, maxStepUp: 1, maxDrop: 1 },
  phases: [{ id: "entrance-repair", dependsOn: [] }],
  operations,
  protectedClearance,
  routeChecks,
  styleChecks,
  lightingChecks,
  acceptance: {
    requiredViews: ["south-approach", "east-passage", "central-passage"],
    ordinaryTraversal: routeChecks.map((route) => route.name),
    actualScanRegions: protectedClearance.map((check) => check.name),
  },
};

await writeFile(OUTPUT, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const config = JSON.parse(await readFile("D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8"));
const apply = process.argv.includes("--apply");
const response = await fetch(`http://127.0.0.1:${config.port}/v1/apply`, {
  method: "POST",
  headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    operations: operations.map(({ phase, ...operation }) => operation),
    label: "Forbidden City Meridian Gate traditional entrances v3",
    projectId: PROJECT_ID,
    dryRun: !apply,
  }),
});
const result = await response.json();
console.log(JSON.stringify({ apply, manifest: OUTPUT, operationCount: operations.length, status: response.status, result }, null, 2));
if (!response.ok || (!apply && !result.canApply)) process.exitCode = 1;
