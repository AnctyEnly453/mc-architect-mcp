import { mkdir, readFile, writeFile } from "node:fs/promises";

const config = JSON.parse(await readFile("D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8"));
const output = "D:/AI WORK/006/output/supreme-harmony-gate-river-v1-existing";
await mkdir(output, { recursive: true });
const headers = { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" };

async function call(path, body) {
  const response = await fetch(`http://127.0.0.1:${config.port}${path}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${result.error ?? response.statusText}`);
  return result;
}

const tiles = [];
for (const [xi, [x1, x2]] of [[1, [660, 779]], [2, [780, 900]]]) {
  for (const [zi, [z1, z2]] of [[1, [355, 395]], [2, [396, 435]]]) {
    tiles.push({ name: `checkpoint-x${xi}-z${zi}`, from: { x: x1, y: 165, z: z1 }, to: { x: x2, y: 205, z: z2 } });
  }
}

const results = [];
await call("/v1/camera/begin", { spectator: true });
try {
  for (const tile of tiles) {
    await call("/v1/camera/move", {
      position: { x: (tile.from.x + tile.to.x) / 2, y: 230, z: (tile.from.z + tile.to.z) / 2 },
      pitch: 90,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const scan = await call("/v1/scan", { from: tile.from, to: tile.to, mode: "full" });
    await writeFile(`${output}/${tile.name}.json`, `${JSON.stringify(scan, null, 2)}\n`);
    results.push({ name: tile.name, bounds: scan.bounds, size: scan.size, runCount: scan.runs.length });
  }
} finally {
  await call("/v1/camera/restore", {});
}

await writeFile(`${output}/index.json`, `${JSON.stringify({ createdAt: new Date().toISOString(), results }, null, 2)}\n`);
console.log(JSON.stringify({ output, scans: results.length, results }, null, 2));
