import { readFile } from "node:fs/promises";

const PROJECT_ID = "forbidden-city-wumen-facade-v5";
const operations = [];
const add = (block, x1, y1, z1, x2, y2, z2) => operations.push({
  block,
  from: { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2) },
  to: { x: Math.max(x1, x2), y: Math.max(y1, y2), z: Math.max(z1, z2) },
});

// Remove only the previous decorative skin; retain the structural wall and passages.
add("minecraft:air", 694, 174, 508, 866, 196, 509);

const solidBays = [[694, 717], [743, 767], [793, 817], [843, 866]];
for (const [x1, x2] of solidBays) {
  add("minecraft:red_terracotta", x1, 174, 508, x2, 191, 509);
  add("minecraft:polished_andesite", x1, 174, 508, x2, 176, 509);
  // Two substantial posts replace the former picket-like rhythm.
  add("minecraft:dark_oak_log[axis=y]", x1, 174, 507, x1 + 2, 193, 509);
  add("minecraft:dark_oak_log[axis=y]", x2 - 2, 174, 507, x2, 193, 509);
  add("minecraft:dark_oak_log[axis=x]", x1, 190, 507, x2, 193, 509);
}

// One broad lattice window per occupied side room.
for (const [x1, x2] of [[743, 767], [793, 817]]) {
  const cx = Math.floor((x1 + x2) / 2);
  add("minecraft:black_stained_glass", cx - 5, 179, 507, cx + 5, 186, 509);
  add("minecraft:dark_oak_log[axis=y]", cx - 6, 178, 506, cx - 4, 188, 509);
  add("minecraft:dark_oak_log[axis=y]", cx + 4, 178, 506, cx + 6, 188, 509);
  add("minecraft:dark_oak_log[axis=x]", cx - 6, 178, 506, cx + 6, 180, 509);
  add("minecraft:dark_oak_log[axis=x]", cx - 6, 186, 506, cx + 6, 188, 509);
  add("minecraft:dark_oak_log[axis=y]", cx, 179, 506, cx, 186, 509);
  add("minecraft:dark_oak_log[axis=x]", cx - 5, 182, 506, cx + 5, 183, 509);
}

// Outer bays remain calmer, with recessed blind panels instead of more glazing.
for (const [x1, x2] of [[694, 717], [843, 866]]) {
  add("minecraft:dark_oak_planks", x1 + 6, 179, 507, x2 - 6, 186, 509);
  add("minecraft:red_terracotta", x1 + 8, 181, 506, x2 - 8, 184, 509);
}

// Side passages use restrained frames; the central passage receives a taller hierarchy.
for (const [x1, x2] of [[718, 742], [818, 842]]) {
  add("minecraft:dark_oak_log[axis=y]", x1, 174, 507, x1 + 2, 190, 509);
  add("minecraft:dark_oak_log[axis=y]", x2 - 2, 174, 507, x2, 190, 509);
  add("minecraft:dark_oak_log[axis=x]", x1, 188, 507, x2, 191, 509);
  const cx = Math.floor((x1 + x2) / 2);
  add("minecraft:gold_block", cx - 3, 192, 508, cx + 3, 193, 509);
}

add("minecraft:dark_oak_log[axis=y]", 768, 174, 506, 771, 194, 509);
add("minecraft:dark_oak_log[axis=y]", 789, 174, 506, 792, 194, 509);
add("minecraft:dark_oak_log[axis=x]", 768, 191, 506, 792, 195, 509);
add("minecraft:gold_block", 776, 196, 507, 784, 197, 509);

// Deep, dark eave underside and spaced bracket clusters add depth without another gold stripe.
add("minecraft:dark_oak_planks", 698, 197, 502, 862, 199, 507);
for (const x of [700, 724, 748, 772, 788, 812, 836, 860]) {
  add("minecraft:dark_oak_stairs[facing=south,half=top,shape=straight,waterlogged=false]", x - 2, 196, 506, x + 2, 198, 508);
}

// Remove the broad gold roof stripes while preserving the imperial yellow roof and ridge accents.
add("minecraft:yellow_terracotta", 700, 201, 453, 860, 201, 503);
for (const i of [0, 3, 6, 9]) {
  add("minecraft:yellow_terracotta", 700 + i * 2, 202 + i, 453 + i, 860 - i * 2, 202 + i, 503 - i);
}

// Recompose the upper tower facade with three large structural bays and smaller dark windows.
add("minecraft:red_terracotta", 730, 213, 489, 830, 222, 491);
for (const x of [730, 779, 828]) {
  add("minecraft:dark_oak_log[axis=y]", x, 212, 488, x + 2, 223, 491);
}
add("minecraft:dark_oak_log[axis=x]", 730, 220, 488, 830, 223, 491);
for (const cx of [750, 810]) {
  add("minecraft:black_stained_glass", cx - 7, 215, 488, cx + 7, 219, 491);
  add("minecraft:dark_oak_log[axis=y]", cx - 8, 214, 487, cx - 6, 220, 491);
  add("minecraft:dark_oak_log[axis=y]", cx + 6, 214, 487, cx + 8, 220, 491);
  add("minecraft:dark_oak_log[axis=x]", cx - 8, 214, 487, cx + 8, 215, 491);
  add("minecraft:dark_oak_log[axis=x]", cx - 8, 219, 487, cx + 8, 220, 491);
  add("minecraft:dark_oak_log[axis=y]", cx, 215, 487, cx, 219, 491);
}
add("minecraft:dark_oak_planks", 771, 215, 488, 789, 220, 491);
add("minecraft:gold_block", 775, 216, 487, 785, 219, 491);

add("minecraft:yellow_terracotta", 726, 225, 462, 834, 225, 494);
for (const i of [0, 3, 6]) {
  add("minecraft:yellow_terracotta", 728 + i * 2, 226 + i, 462 + i, 832 - i * 2, 226 + i, 494 - i);
}

const config = JSON.parse(await readFile("D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8"));
const apply = process.argv.includes("--apply");
const response = await fetch(`http://127.0.0.1:${config.port}/v1/apply`, {
  method: "POST",
  headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ operations, label: "Meridian Gate subtractive facade reconstruction v5", projectId: PROJECT_ID, dryRun: !apply }),
});
const result = await response.json();
console.log(JSON.stringify({ apply, operationCount: operations.length, status: response.status, result }, null, 2));
if (!response.ok || (!apply && !result.canApply)) process.exitCode = 1;
