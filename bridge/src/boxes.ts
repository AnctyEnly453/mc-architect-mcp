import { FillOperation, Position } from "./client.js";

export type BoxMode = "solid" | "hollow" | "outline";

export function boxOperations(from: Position, to: Position, block: string, mode: BoxMode): FillOperation[] {
  const min = {
    x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), z: Math.min(from.z, to.z),
  };
  const max = {
    x: Math.max(from.x, to.x), y: Math.max(from.y, to.y), z: Math.max(from.z, to.z),
  };
  if (mode === "solid") return [{ from: min, to: max, block }];

  const operations: FillOperation[] = [];
  const add = (a: Position, b: Position) => {
    if (a.x <= b.x && a.y <= b.y && a.z <= b.z) operations.push({ from: a, to: b, block });
  };
  if (mode === "hollow") {
    add(min, { x: max.x, y: min.y, z: max.z });
    if (max.y !== min.y) add({ x: min.x, y: max.y, z: min.z }, max);
    add({ x: min.x, y: min.y + 1, z: min.z }, { x: min.x, y: max.y - 1, z: max.z });
    if (max.x !== min.x) add({ x: max.x, y: min.y + 1, z: min.z }, { x: max.x, y: max.y - 1, z: max.z });
    add({ x: min.x + 1, y: min.y + 1, z: min.z }, { x: max.x - 1, y: max.y - 1, z: min.z });
    if (max.z !== min.z) add({ x: min.x + 1, y: min.y + 1, z: max.z }, { x: max.x - 1, y: max.y - 1, z: max.z });
    return operations;
  }

  // Twelve edges, deduplicated by assigning corners to the X-axis edges first.
  for (const y of unique([min.y, max.y])) for (const z of unique([min.z, max.z])) {
    add({ x: min.x, y, z }, { x: max.x, y, z });
  }
  for (const x of unique([min.x, max.x])) for (const z of unique([min.z, max.z])) {
    add({ x, y: min.y + 1, z }, { x, y: max.y - 1, z });
  }
  for (const x of unique([min.x, max.x])) for (const y of unique([min.y, max.y])) {
    add({ x, y, z: min.z + 1 }, { x, y, z: max.z - 1 });
  }
  return operations;
}

function unique(values: number[]): number[] {
  return [...new Set(values)];
}
