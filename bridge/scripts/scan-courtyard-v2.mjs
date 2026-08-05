import { mkdir, readFile, writeFile } from "node:fs/promises";

const config = JSON.parse(await readFile("D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8"));
const output = "D:/AI WORK/006/output/courtyard-v2-existing";
await mkdir(output, { recursive: true });
const headers = { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" };
async function call(path, body) {
  const response = await fetch(`http://127.0.0.1:${config.port}${path}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${result.error}`);
  return result;
}
async function scan(name, body) {
  await call("/v1/camera/move", {
    position: {
      x: (body.from.x + body.to.x) / 2,
      y: 225,
      z: (body.from.z + body.to.z) / 2,
    },
    pitch: 90,
  });
  await new Promise((resolve) => setTimeout(resolve, 350));
  const response = await fetch(`http://127.0.0.1:${config.port}/v1/scan`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${name}: ${result.error}`);
  await writeFile(`${output}/${name}.json`, `${JSON.stringify(result, null, 2)}\n`);
  return { name, bounds: result.bounds, size: result.size, runs: result.runs?.length };
}

const results = [];
await call("/v1/camera/begin", { spectator: true });
try {
  results.push(await scan("bridges", {
    from: { x: 670, y: 168, z: 358 }, to: { x: 890, y: 180, z: 387 }, mode: "full",
  }));

  let part = 0;
  for (let x = 620; x <= 940; x += 60) {
    for (let z = 245; z <= 359; z += 50) {
      part++;
      results.push(await scan(`core-${String(part).padStart(2, "0")}`, {
        from: { x, y: 168, z },
        to: { x: Math.min(940, x + 59), y: 245, z: Math.min(359, z + 49) },
        mode: "full",
      }));
    }
  }
} finally {
  await call("/v1/camera/restore", {});
}
console.log(JSON.stringify({ output, scans: results.length, results }, null, 2));
