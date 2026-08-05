import test from "node:test";
import assert from "node:assert/strict";
import {
  circleOperations,
  curvedWallOperations,
  domeOperations,
  spiralStairOperations,
} from "../dist/geometry.js";
import { boxOperations } from "../dist/boxes.js";

const center = { x: 10, y: 64, z: -5 };

test("filled horizontal circle is compressed and includes its center", () => {
  const operations = circleOperations(center, 4, "xz", "minecraft:stone", true, 1);
  assert.ok(operations.length < 16);
  assert.ok(operations.some(({ from, to }) => from.y === 64 && from.z === -5 && from.x <= 10 && to.x >= 10));
});

test("curved wall cuboids span the requested height", () => {
  const operations = curvedWallOperations(center, 8, 0, 90, 6, 1, "minecraft:stone_bricks");
  assert.ok(operations.length > 0 && operations.length <= 256);
  assert.ok(operations.every(({ from, to }) => from.y === 64 && to.y === 69));
});

test("hollow dome remains inside its upper hemisphere", () => {
  const operations = domeOperations(center, 6, "minecraft:glass", false, 1);
  assert.ok(operations.length > 0 && operations.length <= 256);
  assert.ok(operations.every(({ from, to }) => from.y >= 64 && to.y <= 70));
});

test("spiral stair blocks receive orientation when unspecified", () => {
  const operations = spiralStairOperations(center, 3, 12, 1.5, true, "minecraft:stone_brick_stairs");
  assert.equal(operations.length, 12);
  assert.ok(operations.every(({ block }) => block.includes("[facing=") && block.includes("half=bottom")));
});

test("hollow box uses at most six non-overlapping faces", () => {
  const operations = boxOperations({ x: 0, y: 0, z: 0 }, { x: 9, y: 9, z: 9 }, "minecraft:stone", "hollow");
  assert.equal(operations.length, 6);
});

test("outline box collapses safely for a one-block axis", () => {
  const operations = boxOperations({ x: 0, y: 0, z: 0 }, { x: 0, y: 5, z: 5 }, "minecraft:stone", "outline");
  assert.ok(operations.length > 0);
  assert.ok(operations.every(({ from, to }) => from.x <= to.x && from.y <= to.y && from.z <= to.z));
});
