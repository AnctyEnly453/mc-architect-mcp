import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MinecraftClient } from "./client.js";
import { readPreparedProject, sectionFile, sha256 } from "./project-plan.js";

export async function uploadProject(directory: string, client: Pick<MinecraftClient, "project">,
  progress?: (uploaded: number, total: number) => void) {
  const manifest = await readPreparedProject(directory);
  await client.project({ action: "open", projectId: manifest.projectId, worldId: manifest.worldId,
    dimension: manifest.dimension, planId: manifest.planId, sectionCount: manifest.sectionCount });
  for (let index = 0; index < manifest.sectionCount; index++) {
    const data = await readFile(join(resolve(directory), "sections", sectionFile(index)), "utf8");
    if (sha256(data) !== manifest.hashes[index]) throw new Error(`Prepared section ${index} changed; prepare again`);
    // Repeating an upload is safe even if a previous HTTP response was lost.
    await client.project({ action: "upload", planId: manifest.planId, index, data });
    progress?.(index + 1, manifest.sectionCount);
  }
  return { planId: manifest.planId, uploaded: manifest.sectionCount, status: "uploaded" };
}
