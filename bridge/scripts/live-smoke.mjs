import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const client = new Client({ name: "mcarchitect-live-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: process.env,
});

function textResult(result) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  return text ? JSON.parse(text) : {};
}

await client.connect(transport);
try {
  const before = textResult(await client.callTool({ name: "mc_get_context", arguments: {} }));
  const { x, y, z } = before.position;
  const capture = await client.callTool({
    name: "mc_capture_inspection",
    arguments: {
      settleMs: 750,
      views: [
        { name: "level", position: { x, y: y + 8, z }, yaw: before.rotation.yaw, pitch: 20, fov: 70 },
        { name: "overhead", position: { x, y: y + 16, z }, yaw: before.rotation.yaw, pitch: 90, fov: 70 },
      ],
    },
  });
  const after = textResult(await client.callTool({ name: "mc_get_context", arguments: {} }));
  const images = capture.content?.filter((item) => item.type === "image") ?? [];
  console.log(JSON.stringify({
    images: images.map((item) => ({ mimeType: item.mimeType, bytes: Math.floor(item.data.length * 0.75) })),
    restored: {
      position: before.position.x === after.position.x
        && before.position.y === after.position.y
        && before.position.z === after.position.z,
      rotation: before.rotation.yaw === after.rotation.yaw && before.rotation.pitch === after.rotation.pitch,
      gameMode: before.gameMode === after.gameMode,
    },
  }, null, 2));
} finally {
  await client.close();
}
