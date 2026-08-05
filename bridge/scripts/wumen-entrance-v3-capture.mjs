import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile("D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json", "utf8"));
const base = `http://127.0.0.1:${config.port}`;
const headers = { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" };
async function call(path, body) {
  const response = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
  return result;
}

await call("/v1/camera/begin", { spectator: true });
const captures = [];
try {
  for (const view of [
    { name: "south-approach", position: { x: 780, y: 178, z: 520 }, yaw: 180, pitch: 12, fov: 70 },
    { name: "central-passage", position: { x: 780, y: 176, z: 490 }, yaw: 0, pitch: 8, fov: 70 },
  ]) {
    await call("/v1/camera/move", view);
    await new Promise((resolve) => setTimeout(resolve, 700));
    captures.push({ name: view.name, ...(await call("/v1/screenshot", {})) });
  }
} finally {
  await call("/v1/camera/restore", {});
}
console.log(JSON.stringify(captures, null, 2));
