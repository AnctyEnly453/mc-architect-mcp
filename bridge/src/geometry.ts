import { FillOperation, Position } from "./client.js";

export type Plane = "xz" | "xy" | "yz";

export function circleOperations(
  center: Position,
  radius: number,
  plane: Plane,
  block: string,
  filled: boolean,
  thickness: number,
): FillOperation[] {
  const rows: FillOperation[] = [];
  for (let v = -radius; v <= radius; v++) {
    const cells: number[] = [];
    for (let u = -radius; u <= radius; u++) {
      const distance = Math.hypot(u, v);
      const selected = filled
        ? distance <= radius + 0.35
        : distance <= radius + 0.5 && distance >= radius - thickness + 0.5;
      if (selected) cells.push(u);
    }
    rows.push(...compressRow(cells, (u) => planePosition(center, plane, u, v), block));
  }
  return rows;
}

export function curvedWallOperations(
  center: Position,
  radius: number,
  startAngle: number,
  endAngle: number,
  height: number,
  thickness: number,
  block: string,
): FillOperation[] {
  const cells = new Set<string>();
  const span = normalizedSpan(startAngle, endAngle);
  const samples = Math.max(2, Math.ceil(span * Math.PI / 180 * (radius + thickness) * 2));
  for (let sample = 0; sample <= samples; sample++) {
    const angle = (startAngle + span * sample / samples) * Math.PI / 180;
    for (let inset = 0; inset < thickness; inset++) {
      const r = radius - inset;
      cells.add(`${Math.round(center.x + Math.cos(angle) * r)},${Math.round(center.z + Math.sin(angle) * r)}`);
    }
  }
  return compressColumns(cells, center.y, center.y + height - 1, block);
}

export function domeOperations(
  center: Position,
  radius: number,
  block: string,
  filled: boolean,
  thickness: number,
): FillOperation[] {
  const operations: FillOperation[] = [];
  for (let dy = 0; dy <= radius; dy++) {
    const outer = Math.sqrt(radius * radius - dy * dy);
    const innerRadius = Math.max(0, radius - thickness);
    const inner = dy >= innerRadius ? -1 : Math.sqrt(innerRadius * innerRadius - dy * dy);
    for (let z = -Math.ceil(outer); z <= Math.ceil(outer); z++) {
      const xs: number[] = [];
      for (let x = -Math.ceil(outer); x <= Math.ceil(outer); x++) {
        const horizontal = Math.hypot(x, z);
        if (horizontal <= outer + 0.35 && (filled || inner < 0 || horizontal >= inner - 0.35)) xs.push(x);
      }
      operations.push(...compressRow(xs, (x) => ({ x: center.x + x, y: center.y + dy, z: center.z + z }), block));
    }
  }
  return operations;
}

export function spiralStairOperations(
  center: Position,
  radius: number,
  height: number,
  turns: number,
  clockwise: boolean,
  block: string,
): FillOperation[] {
  const operations: FillOperation[] = [];
  const direction = clockwise ? -1 : 1;
  for (let step = 0; step < height; step++) {
    const progress = height === 1 ? 0 : step / (height - 1);
    const angle = direction * turns * Math.PI * 2 * progress;
    const position = {
      x: Math.round(center.x + Math.cos(angle) * radius),
      y: center.y + step,
      z: Math.round(center.z + Math.sin(angle) * radius),
    };
    const tangentX = -Math.sin(angle) * direction;
    const tangentZ = Math.cos(angle) * direction;
    operations.push({ from: position, to: position, block: orientedStair(block, tangentX, tangentZ) });
  }
  return operations;
}

function planePosition(center: Position, plane: Plane, u: number, v: number): Position {
  if (plane === "xz") return { x: center.x + u, y: center.y, z: center.z + v };
  if (plane === "xy") return { x: center.x + u, y: center.y + v, z: center.z };
  return { x: center.x, y: center.y + v, z: center.z + u };
}

function compressRow(cells: number[], position: (value: number) => Position, block: string): FillOperation[] {
  if (cells.length === 0) return [];
  const operations: FillOperation[] = [];
  let start = cells[0];
  let previous = start;
  for (let index = 1; index < cells.length; index++) {
    const current = cells[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    operations.push({ from: position(start), to: position(previous), block });
    start = current;
    previous = current;
  }
  operations.push({ from: position(start), to: position(previous), block });
  return operations;
}

function compressColumns(cells: Set<string>, minY: number, maxY: number, block: string): FillOperation[] {
  const byZ = new Map<number, number[]>();
  for (const cell of cells) {
    const [x, z] = cell.split(",").map(Number);
    const row = byZ.get(z) ?? [];
    row.push(x);
    byZ.set(z, row);
  }
  const operations: FillOperation[] = [];
  for (const [z, xs] of [...byZ].sort(([a], [b]) => a - b)) {
    xs.sort((a, b) => a - b);
    operations.push(...compressRow(xs, (x) => ({ x, y: minY, z }), block)
      .map((operation) => ({ ...operation, to: { ...operation.to, y: maxY } })));
  }
  return operations;
}

function normalizedSpan(start: number, end: number): number {
  let span = end - start;
  while (span <= 0) span += 360;
  return Math.min(span, 360);
}

function orientedStair(block: string, dx: number, dz: number): string {
  if (!block.includes("_stairs") || block.includes("[")) return block;
  const facing = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "east" : "west") : (dz > 0 ? "south" : "north");
  return `${block}[facing=${facing},half=bottom,shape=straight,waterlogged=false]`;
}
