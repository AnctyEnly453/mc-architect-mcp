import { readFile } from "node:fs/promises";

const CONFIG = "D:/PCL/.minecraft/versions/1.21.11-Fabric 0.19.2/config/mcarchitect.json";
const DESIGN = "D:/AI WORK/006/output/wumen-entrance-v3-design.json";

const config = JSON.parse(await readFile(CONFIG, "utf8"));
const manifest = JSON.parse(await readFile(DESIGN, "utf8"));
const baseUrl = `http://127.0.0.1:${config.port}`;

async function request(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${result.error ?? `HTTP ${response.status}`}`);
  return result;
}

const operations = manifest.operations.map(({ phase, ...operation }) => operation);
const comparison = await request("/v1/compare", {
  operations,
  ignoreState: false,
  maxDifferences: 64,
});

const access = [];
for (const route of manifest.routeChecks) {
  const result = await request("/v1/access", {
    from: manifest.bounds.from,
    to: manifest.bounds.to,
    start: route.start,
    goals: route.goals,
    height: manifest.movementProfile.height,
    maxStepUp: manifest.movementProfile.maxStepUp,
    maxDrop: manifest.movementProfile.maxDrop,
    maxVisited: 100000,
  });
  access.push({ name: route.name, ...result });
}

const scanBounds = {
  from: manifest.bounds.from,
  to: manifest.bounds.to,
};
const [collision, lighting] = await Promise.all([
  request("/v1/scan", { ...scanBounds, mode: "collision" }),
  request("/v1/scan", { ...scanBounds, mode: "lighting" }),
]);

const differenceCount = comparison.summary
  ? (comparison.summary.missing ?? 0)
    + (comparison.summary.unexpected ?? 0)
    + (comparison.summary.stateMismatch ?? 0)
  : (comparison.missingCount ?? 0)
    + (comparison.unexpectedCount ?? 0)
    + (comparison.stateMismatchCount ?? 0);
const inaccessible = access.filter((result) => {
  if (typeof result.reachable === "boolean") return !result.reachable;
  if (Array.isArray(result.results)) return result.results.some((goal) => !goal.reachable && !goal.passed);
  if (Array.isArray(result.goals)) return result.goals.some((goal) => !goal.reachable && !goal.passed);
  return false;
});

console.log(JSON.stringify({
  projectId: manifest.project.id,
  comparison: {
    passed: comparison.passed,
    differenceCount: comparison.differenceCount,
    matchedBlocks: comparison.matchedBlocks,
    comparedBlocks: comparison.comparedBlocks,
  },
  access: access.map((result) => ({
    name: result.name,
    passed: result.passed,
    visited: result.visited,
    goals: result.goals?.map((goal) => ({ reachable: goal.reachable, pathLength: goal.pathLength })),
  })),
  collision: {
    mode: collision.mode,
    standableCells: collision.standableCells,
    palette: collision.palette,
  },
  lighting: {
    mode: lighting.mode,
    blockLightHistogram: lighting.blockLightHistogram,
    darkStandableCount: lighting.darkStandableCount,
    spawnRiskCandidateCount: lighting.spawnRiskCandidateCount,
  },
  passed: differenceCount === 0 && inaccessible.length === 0,
}, null, 2));

if (differenceCount !== 0 || inaccessible.length !== 0) process.exitCode = 1;
