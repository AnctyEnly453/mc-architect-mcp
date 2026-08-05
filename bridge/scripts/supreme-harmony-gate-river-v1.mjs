import { mkdir, readFile, writeFile } from "node:fs/promises";

const PROJECT_ID = "forbidden-city-supreme-harmony-gate-river-v1";
const OUTPUT = "D:/AI WORK/006/output/supreme-harmony-gate-river-v1-manifest.json";
const phases = { clear: [], river: [], gate: [], bridges: [], finish: [] };
let active = "clear";

const add = (block, x1, y1, z1, x2, y2, z2) => phases[active].push({
  block,
  from: { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2) },
  to: { x: Math.max(x1, x2), y: Math.max(y1, y2), z: Math.max(z1, z2) },
});
const volume = (op) => (op.to.x - op.from.x + 1) * (op.to.y - op.from.y + 1) * (op.to.z - op.from.z + 1);

function ring(block, x1, y1, z1, x2, y2, z2, thickness = 1) {
  add(block, x1, y1, z1, x2, y2, z1 + thickness - 1);
  add(block, x1, y1, z2 - thickness + 1, x2, y2, z2);
  add(block, x1, y1, z1 + thickness, x1 + thickness - 1, y2, z2 - thickness);
  add(block, x2 - thickness + 1, y1, z1 + thickness, x2, y2, z2 - thickness);
}

function riverProfile(x) {
  const normalized = Math.abs(x - 780) / 115;
  const center = 370 + Math.round(4 * normalized ** 1.5);
  const edgeDistance = Math.min(x - 665, 895 - x);
  const halfWidth = Math.min(6, 2 + Math.floor(Math.max(0, edgeDistance) / 4));
  return { center, halfWidth };
}

function riverGroups() {
  const result = [];
  let current = null;
  for (let x = 665; x <= 895; x++) {
    const profile = riverProfile(x);
    const key = `${profile.center}:${profile.halfWidth}`;
    if (!current || current.key !== key) {
      current = { key, x1: x, x2: x, ...profile };
      result.push(current);
    } else current.x2 = x;
  }
  return result;
}

function bridge(cx, halfWidth) {
  const { center, halfWidth: waterHalf } = riverProfile(cx);
  const start = center - waterHalf - 3;
  const end = center + waterHalf + 3;
  for (let i = 0; i < 4; i++) {
    add("minecraft:quartz_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]",
      cx - halfWidth, 169 + i, start + i, cx + halfWidth, 169 + i, start + i);
  }
  add("minecraft:smooth_quartz", cx - halfWidth, 173, start + 4, cx + halfWidth, 173, end - 4);
  for (let i = 0; i < 4; i++) {
    add("minecraft:quartz_stairs[facing=south,half=bottom,shape=straight,waterlogged=false]",
      cx - halfWidth, 172 - i, end - 3 + i, cx + halfWidth, 172 - i, end - 3 + i);
  }
  for (const z of [center - 3, center + 3]) {
    add("minecraft:chiseled_stone_bricks", cx - halfWidth, 165, z, cx + halfWidth, 172, z + 1);
  }
  add("minecraft:diorite_wall", cx - halfWidth, 174, start + 4, cx - halfWidth, 174, end - 4);
  add("minecraft:diorite_wall", cx + halfWidth, 174, start + 4, cx + halfWidth, 174, end - 4);
  return { cx, halfWidth, center, start, end };
}

// Demolish only the flawed lower gate and the rectangular raised pool. Existing roof Y>=186 is retained.
active = "clear";
add("minecraft:air", 665, 165, 356, 895, 178, 383);
add("minecraft:air", 719, 168, 376, 841, 185, 418);

// A recessed, tapered bow-shaped Golden Water River with a visible bed and continuous masonry banks.
active = "river";
add("minecraft:stone_bricks", 665, 165, 356, 895, 168, 383);
add("minecraft:smooth_stone", 665, 169, 356, 895, 169, 383);
for (const group of riverGroups()) {
  const low = group.center - group.halfWidth;
  const high = group.center + group.halfWidth;
  add("minecraft:prismarine_bricks", group.x1, 165, low, group.x2, 165, high);
  add("minecraft:water[level=0]", group.x1, 166, low, group.x2, 168, high);
  add("minecraft:air", group.x1, 169, low, group.x2, 169, high);
  add("minecraft:polished_andesite", group.x1, 169, low - 2, group.x2, 169, low - 1);
  add("minecraft:polished_andesite", group.x1, 169, high + 1, group.x2, 169, high + 2);
}

// Rebuild the lower Gate of Supreme Harmony as three aligned passages and four usable guard rooms.
active = "gate";
add("minecraft:stone_bricks", 719, 168, 380, 841, 169, 418);
add("minecraft:polished_andesite", 719, 170, 380, 841, 170, 418);
add("minecraft:dark_oak_planks", 724, 170, 381, 836, 170, 413);
ring("minecraft:red_terracotta", 724, 171, 381, 836, 184, 413, 2);
add("minecraft:air", 726, 171, 383, 834, 184, 411);
add("minecraft:dark_oak_planks", 724, 185, 381, 836, 185, 413);

const passages = [
  { id: "west-passage", cx: 742, half: 4 },
  { id: "central-passage", cx: 780, half: 6 },
  { id: "east-passage", cx: 818, half: 4 },
];
for (const passage of passages) {
  const x1 = passage.cx - passage.half, x2 = passage.cx + passage.half;
  add("minecraft:polished_andesite", x1, 170, 380, x2, 170, 418);
  add("minecraft:air", x1, 171, 380, x2, 183, 418);
  for (const z of [381, 413]) {
    add("minecraft:dark_oak_log[axis=y]", x1 - 1, 171, z - 1, x1 - 1, 184, z + 1);
    add("minecraft:dark_oak_log[axis=y]", x2 + 1, 171, z - 1, x2 + 1, 184, z + 1);
    add("minecraft:dark_oak_planks", x1 - 1, 182, z - 1, x2 + 1, 184, z + 1);
  }
}

const rooms = [
  { id: "west-outer-room", x1: 726, x2: 735, center: 730, door: { x1: 735, x2: 738 } },
  { id: "west-inner-room", x1: 749, x2: 773, center: 761, door: { x1: 771, x2: 774 } },
  { id: "east-inner-room", x1: 787, x2: 811, center: 799, door: { x1: 786, x2: 789 } },
  { id: "east-outer-room", x1: 825, x2: 834, center: 830, door: { x1: 822, x2: 825 } },
];
const ROOM_DOOR_Z1 = 393;
const ROOM_DOOR_Z2 = 397;
for (const room of rooms) {
  add("minecraft:dark_oak_planks", room.x1, 170, 383, room.x2, 170, 411);
  add("minecraft:air", room.x1 + 1, 171, 384, room.x2 - 1, 181, 410);
  add("minecraft:white_terracotta", room.x1, 171, 383, room.x1, 181, 411);
  add("minecraft:white_terracotta", room.x2, 171, 383, room.x2, 181, 411);
  for (const x of [room.x1, room.x2]) {
    for (const z of [383, 391, 399, 407, 411]) add("minecraft:dark_oak_log[axis=y]", x, 171, z, x, 184, z);
  }
  add("minecraft:air", room.door.x1, 171, ROOM_DOOR_Z1, room.door.x2, 175, ROOM_DOOR_Z2);
  add("minecraft:red_carpet", room.x1 + 2, 171, 387, room.x2 - 2, 171, 407);
}

// South-facing and river-facing facade bays: restrained black lattice, white infill, and dark timber frames.
for (const room of rooms) {
  for (const z of [381, 413]) {
    add("minecraft:white_terracotta", room.x1, 173, z, room.x2, 181, z + (z === 381 ? 1 : 0));
    if (room.x2 - room.x1 >= 8) {
      // A real window needs depth clearance. The red shell is two blocks thick, so
      // replacing only its outer face with glass leaves a solid wall immediately behind it.
      const innerClearZ = z === 381 ? 382 : 412;
      add("minecraft:air", room.x1 + 2, 175, innerClearZ, room.x2 - 2, 179, innerClearZ);
      add("minecraft:black_stained_glass", room.x1 + 2, 175, z, room.x2 - 2, 179, z);
    }
    add("minecraft:dark_oak_log[axis=y]", room.x1, 171, z - 1, room.x1 + 1, 184, z + 1);
    add("minecraft:dark_oak_log[axis=y]", room.x2 - 1, 171, z - 1, room.x2, 184, z + 1);
  }
}

// Low open balustrades frame the veranda without crossing any portal axis.
const facadeSegments = [[719, 736], [748, 772], [788, 812], [824, 841]];
for (const [x1, x2] of facadeSegments) {
  add("minecraft:stone_brick_wall", x1, 171, 380, x2, 171, 380);
  add("minecraft:stone_brick_wall", x1, 171, 418, x2, 171, 418);
}
add("minecraft:stone_brick_wall", 719, 171, 381, 719, 171, 417);
add("minecraft:stone_brick_wall", 841, 171, 381, 841, 171, 417);

// A readable plaque and bracket band on the side the user is facing.
add("minecraft:dark_oak_planks", 774, 182, 414, 786, 184, 414);
add("minecraft:yellow_terracotta", 777, 183, 415, 783, 184, 415);
for (const x of [730, 754, 766, 793, 805, 829]) {
  add("minecraft:dark_oak_log[axis=y]", x, 171, 412, x + 1, 184, 414);
}

// Five open-ended bridges follow the curved section instead of spanning a rectangular pool.
active = "bridges";
const bridgeData = [
  bridge(704, 3), bridge(742, 3), bridge(780, 5), bridge(818, 3), bridge(856, 3),
];

// Interior furniture and collision-free lighting are a final layer, after every opening is fixed.
active = "finish";
for (const room of rooms) {
  for (const z of [390, 404]) {
    add("minecraft:dark_oak_fence", room.center, 181, z, room.center, 184, z);
    add("minecraft:lantern[hanging=true,waterlogged=false]", room.center, 180, z, room.center, 180, z);
    add("minecraft:light[level=15]", room.center, 175, z, room.center, 175, z);
  }
  const westSide = room.center < 780;
  const benchX = westSide ? room.x1 + 2 : room.x2 - 2;
  const facing = westSide ? "east" : "west";
  add(`minecraft:dark_oak_stairs[facing=${facing},half=bottom,shape=straight,waterlogged=false]`, benchX, 171, 386, benchX, 171, 408);
  if (room.x2 - room.x1 >= 20) {
    for (const x of [room.center - 8, room.center, room.center + 8]) {
      for (const z of [388, 397, 406]) add("minecraft:light[level=15]", x, 175, z, x, 175, z);
    }
  }
}
for (const passage of passages) {
  const lightXs = passage.half >= 6
    ? [passage.cx - 4, passage.cx, passage.cx + 4]
    : [passage.cx];
  for (const x of lightXs) {
    for (const z of [386, 398, 410]) add("minecraft:light[level=15]", x, 175, z, x, 175, z);
  }
}
for (const x of [734, 758, 802, 826]) {
  add("minecraft:dark_oak_fence", x, 180, 410, x, 184, 410);
  add("minecraft:lantern[hanging=true,waterlogged=false]", x, 179, 410, x, 179, 410);
}

// Own the south threshold geometry instead of assuming the retained courtyard is level.
// The existing apron drops two blocks in front of the side portals; broad landings make
// every passage traversable by an ordinary player and keep all three entrances consistent.
for (const passage of passages) {
  const x1 = passage.cx - passage.half, x2 = passage.cx + passage.half;
  add("minecraft:stone_bricks", x1, 168, 419, x2, 169, 420);
  add("minecraft:polished_andesite", x1, 170, 419, x2, 170, 420);
  add("minecraft:stone_bricks", x1, 168, 421, x2, 168, 424);
  add("minecraft:polished_andesite", x1, 169, 421, x2, 169, 424);
}

// The two outer bridges terminate at old side-hall walls. Cut deliberate axial portals
// and bridge the hidden four-block floor drop inside each hall with broad landings.
const outerBypasses = [
  { id: "west-outer-bypass", cx: 704 },
  { id: "east-outer-bypass", cx: 856 },
];
for (const bypass of outerBypasses) {
  const x1 = bypass.cx - 3, x2 = bypass.cx + 3;
  add("minecraft:air", x1, 171, 412, x2, 179, 418);
  add("minecraft:air", x1, 172, 419, x2, 179, 419);
  add("minecraft:polished_andesite", x1, 171, 419, x2, 171, 419);
  add("minecraft:stone_bricks", x1, 168, 412, x2, 169, 418);
  add("minecraft:polished_andesite", x1, 170, 412, x2, 170, 418);
  add("minecraft:dark_oak_log[axis=y]", x1 - 1, 172, 419, x1 - 1, 181, 419);
  add("minecraft:dark_oak_log[axis=y]", x2 + 1, 172, 419, x2 + 1, 181, 419);
  add("minecraft:dark_oak_planks", x1 - 1, 180, 419, x2 + 1, 181, 419);

  add("minecraft:stone_bricks", x1, 168, 411, x2, 169, 411);
  add("minecraft:polished_andesite", x1, 170, 411, x2, 170, 411);
  add("minecraft:stone_bricks", x1, 168, 410, x2, 168, 410);
  add("minecraft:polished_andesite", x1, 169, 410, x2, 169, 410);
  add("minecraft:polished_andesite", x1, 168, 409, x2, 168, 409);
  add("minecraft:polished_andesite", x1, 168, 384, x2, 168, 384);
}

function batches(operations, maxGross = 180000, maxOps = 180) {
  const result = []; let current = [], gross = 0;
  for (const op of operations) {
    const size = volume(op);
    if (current.length && (current.length >= maxOps || gross + size > maxGross)) {
      result.push(current); current = []; gross = 0;
    }
    current.push(op); gross += size;
  }
  if (current.length) result.push(current);
  return result;
}

const phaseOrder = ["clear", "river", "gate", "bridges", "finish"];
const phaseDefinitions = [];
const designOperations = [];
let previous = null;
for (const phase of phaseOrder) {
  const parts = batches(phases[phase]);
  parts.forEach((part, index) => {
    const id = `${phase}-${index + 1}`;
    phaseDefinitions.push({ id, dependsOn: previous ? [previous] : [] });
    designOperations.push(...part.map((op) => ({ ...op, phase: id })));
    previous = id;
  });
}

// Only the distant court is retained. Portal thresholds are explicit construction above,
// so design validation cannot silently invent a level approach that the world does not have.
const retainedOperations = [
  { phase: "retained", block: "minecraft:smooth_stone", from: { x: 665, y: 169, z: 425 }, to: { x: 895, y: 169, z: 435 } },
  ...outerBypasses.flatMap((bypass) => [
    { phase: "retained", block: "minecraft:dark_oak_planks", from: { x: bypass.cx - 4, y: 171, z: 420 }, to: { x: bypass.cx + 4, y: 172, z: 425 } },
    { phase: "retained", block: "minecraft:smooth_stone", from: { x: bypass.cx - 4, y: 167, z: 385 }, to: { x: bypass.cx + 4, y: 167, z: 408 } },
  ]),
];
phaseDefinitions.unshift({ id: "retained", dependsOn: [] });

const protectedClearance = [
  ...passages.map((passage) => ({
    name: `${passage.id}-full`,
    from: { x: passage.cx - passage.half, y: 171, z: 380 },
    to: { x: passage.cx + passage.half, y: 181, z: 418 },
  })),
  { name: "west-outer-room-door", from: { x: 735, y: 171, z: ROOM_DOOR_Z1 }, to: { x: 738, y: 174, z: ROOM_DOOR_Z2 } },
  { name: "west-inner-room-door", from: { x: 771, y: 171, z: ROOM_DOOR_Z1 }, to: { x: 774, y: 174, z: ROOM_DOOR_Z2 } },
  { name: "east-inner-room-door", from: { x: 786, y: 171, z: ROOM_DOOR_Z1 }, to: { x: 789, y: 174, z: ROOM_DOOR_Z2 } },
  { name: "east-outer-room-door", from: { x: 822, y: 171, z: ROOM_DOOR_Z1 }, to: { x: 825, y: 174, z: ROOM_DOOR_Z2 } },
  ...outerBypasses.map((bypass) => ({
    name: `${bypass.id}-interior`,
    from: { x: bypass.cx - 3, y: 171, z: 412 },
    to: { x: bypass.cx + 3, y: 179, z: 418 },
  })),
  ...outerBypasses.map((bypass) => ({
    name: `${bypass.id}-portal`,
    from: { x: bypass.cx - 3, y: 172, z: 419 },
    to: { x: bypass.cx + 3, y: 179, z: 419 },
  })),
];

const design = {
  name: "supreme-harmony-gate-river-v1",
  project: { id: PROJECT_ID, scale: "complex", worldId: "PCL-1.21.11", dimension: "minecraft:overworld", revision: 1 },
  bounds: { from: { x: 665, y: 165, z: 356 }, to: { x: 895, y: 205, z: 435 } },
  site: {
    datumY: 169, north: "-z", mainAxis: "z",
    protectedRegions: [
      { id: "retained-gate-roof", from: { x: 715, y: 186, z: 372 }, to: { x: 845, y: 205, z: 422 } },
      { id: "north-main-court", note: "outside the edited river and gate volumes" },
      { id: "south-meridian-court", note: "approach paving is retained" },
    ],
  },
  style: {
    name: "chinese-imperial-gate-and-golden-water-river", module: 6,
    palette: {
      foundation: ["minecraft:stone_bricks", "minecraft:polished_andesite", "minecraft:smooth_stone"],
      structure: ["minecraft:red_terracotta", "minecraft:dark_oak_log[axis=y]"],
      wall: ["minecraft:white_terracotta"], roof: ["retained"], trim: ["minecraft:dark_oak_planks", "minecraft:yellow_terracotta"],
      glazing: ["minecraft:black_stained_glass"], water: ["minecraft:water[level=0]", "minecraft:prismarine_bricks"],
      light: ["minecraft:lantern[hanging=true,waterlogged=false]", "minecraft:light[level=15]"],
    },
  },
  buildings: [{ id: "gate-of-supreme-harmony", bounds: { from: { x: 719, y: 168, z: 380 }, to: { x: 841, y: 205, z: 418 } }, floors: ["gate-ground-floor"] }],
  spaces: [
    { id: "south-court", kind: "exterior", exterior: true }, { id: "north-court", kind: "exterior", exterior: true },
    ...passages.map((passage) => ({ id: passage.id, kind: "occupied", occupied: true, building: "gate-of-supreme-harmony", floor: "gate-ground-floor" })),
    ...rooms.map((room) => ({ id: room.id, kind: "occupied", occupied: true, building: "gate-of-supreme-harmony", floor: "gate-ground-floor" })),
  ],
  portals: [
    ...passages.flatMap((passage) => [
      { id: `${passage.id}-south`, kind: "gate", connects: ["south-court", passage.id], clearanceCheck: `${passage.id}-full` },
      { id: `${passage.id}-north`, kind: "gate", connects: [passage.id, "north-court"], clearanceCheck: `${passage.id}-full` },
    ]),
    { id: "west-outer-room-entry", kind: "doorway", connects: ["west-passage", "west-outer-room"], clearanceCheck: "west-outer-room-door" },
    { id: "west-inner-room-entry", kind: "doorway", connects: ["central-passage", "west-inner-room"], clearanceCheck: "west-inner-room-door" },
    { id: "east-inner-room-entry", kind: "doorway", connects: ["central-passage", "east-inner-room"], clearanceCheck: "east-inner-room-door" },
    { id: "east-outer-room-entry", kind: "doorway", connects: ["east-passage", "east-outer-room"], clearanceCheck: "east-outer-room-door" },
  ],
  defaultBlock: "minecraft:air",
  passableBlocks: ["minecraft:red_carpet", "minecraft:light"],
  movementProfile: { height: 2, maxStepUp: 1, maxDrop: 1 },
  phases: phaseDefinitions,
  operations: [...retainedOperations, ...designOperations],
  protectedClearance,
  routeChecks: [
    ...[704, 742, 780, 818, 856].map((x) => ({
      name: `south-to-north-via-${x}`, startSpace: "south-court", goalSpaces: ["north-court"],
      start: { x, y: (x === 704 || x === 856) ? 173 : 170, z: 425 },
      goals: [{ x, y: 170, z: 356 }],
    })),
    {
      name: "south-court-to-four-guard-rooms", startSpace: "south-court",
      goalSpaces: rooms.map((room) => room.id), start: { x: 742, y: 170, z: 425 },
      goals: rooms.map((room) => ({ x: room.center, y: 171, z: 402 })),
    },
    ...passages.map((passage) => ({
      name: `south-court-to-${passage.id}`, startSpace: "south-court", goalSpaces: [passage.id],
      start: { x: passage.cx, y: 170, z: 425 }, goals: [{ x: passage.cx, y: 171, z: 398 }],
    })),
  ],
  dimensionChecks: [
    { name: "central-passage-width", value: 13, min: 11 },
    { name: "side-passage-width", value: 9, min: 7 },
    { name: "river-depth", value: 4, min: 3 },
    { name: "river-center-bow", value: riverProfile(665).center - riverProfile(780).center, min: 3 },
  ],
  weatherChecks: [{ name: "guard-room-cover", points: rooms.map((room) => ({ x: room.center, y: 171, z: 402 })) }],
  lightingChecks: rooms.map((room) => ({
    name: `${room.id}-lighting`, from: { x: room.x1, y: 171, z: 383 }, to: { x: room.x2, y: 184, z: 411 },
    minimumSources: 2, samplePoints: [{ x: room.center, y: 171, z: 402 }], maxDistance: 14,
  })),
  styleChecks: [{
    name: "south-ceremonial-facade", from: { x: 719, y: 170, z: 410 }, to: { x: 841, y: 185, z: 418 },
    forbiddenBlocks: ["minecraft:cyan_stained_glass", "minecraft:sea_lantern"],
  }],
  symmetryChecks: [{
    name: "gate-river-bilateral-symmetry", axis: "x", coordinate: 780, mode: "base",
    from: { x: 665, y: 165, z: 356 }, to: { x: 895, y: 185, z: 435 },
  }],
  acceptance: {
    requiredViews: ["south-facing-gate", "gate-interior", "bow-river-and-five-bridges"],
    ordinaryTraversal: ["all-five-bridge-crossings", "three-complete-gate-passages", "four-guard-rooms"],
    actualScanRegions: ["lower-gate", "curved-river", "five-bridges"],
    recovery: { checkpointDirectory: "D:/AI WORK/006/output/supreme-harmony-gate-river-v1-existing", projectId: PROJECT_ID },
  },
  bridgeData,
};

await mkdir("D:/AI WORK/006/output", { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(design, null, 2)}\n`);

const config = JSON.parse(await readFile("D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8"));
const headers = { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" };
const apply = process.argv.includes("--apply");
const requested = process.argv.find((arg) => arg.startsWith("--phase="))?.split("=")[1] ?? "all";
const selected = requested === "all" ? phaseOrder : [requested];

async function call(path, body) {
  const response = await fetch(`http://127.0.0.1:${config.port}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${result.error ?? response.statusText}`);
  return result;
}

const results = [];
await call("/v1/camera/begin", { spectator: true });
try {
  for (const phase of selected) {
    const parts = batches(phases[phase]);
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      const bounds = part.reduce((result, op) => ({
        from: { x: Math.min(result.from.x, op.from.x), y: Math.min(result.from.y, op.from.y), z: Math.min(result.from.z, op.from.z) },
        to: { x: Math.max(result.to.x, op.to.x), y: Math.max(result.to.y, op.to.y), z: Math.max(result.to.z, op.to.z) },
      }), { from: { x: Infinity, y: Infinity, z: Infinity }, to: { x: -Infinity, y: -Infinity, z: -Infinity } });
      await call("/v1/camera/move", { position: { x: (bounds.from.x + bounds.to.x) / 2, y: 230, z: (bounds.from.z + bounds.to.z) / 2 }, pitch: 90 });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const result = await call("/v1/apply", {
        operations: part, dryRun: !apply, projectId: PROJECT_ID,
        label: `Supreme Harmony gate and river v1 ${phase} ${index + 1}/${parts.length}`,
      });
      if (!apply && !result.canApply) throw new Error(`${phase} ${index + 1} cannot apply`);
      results.push({ phase, part: index + 1, parts: parts.length, operationCount: part.length, result });
    }
  }
} finally {
  await call("/v1/camera/restore", {});
}

console.log(JSON.stringify({ apply, requested, projectId: PROJECT_ID, manifest: OUTPUT, results }, null, 2));
