import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

type BridgeConfig = { port: number; token: string };

export type Position = { x: number; y: number; z: number };
export type FillOperation = { from: Position; to: Position; block: string };
export type ScreenshotResult = { path: string; mediaType: string; screen: string };
export type ScanMode = "heightmap" | "summary" | "collision" | "lighting" | "full";
export type CameraPosition = { x: number; y: number; z: number };
export type TransformOptions = {
  from: Position;
  to: Position;
  target: Position;
  rotation?: 0 | 90 | 180 | 270;
  mirror?: "none" | "x" | "z";
  copies?: number;
  spacing?: Position;
  includeAir?: boolean;
  label?: string;
  projectId?: string;
  dryRun?: boolean;
};

export class MinecraftClient {
  private constructor(private readonly config: BridgeConfig) {}

  static async create(): Promise<MinecraftClient> {
    const configPath = process.env.MCA_CONFIG ?? defaultConfigPath();
    let raw: string;
    try {
      raw = await readFile(configPath, "utf8");
    } catch (error) {
      throw new Error(
        `Cannot read MC Architect config at ${configPath}. Launch Minecraft with the mod once first.`,
        { cause: error },
      );
    }
    const config = JSON.parse(raw) as Partial<BridgeConfig>;
    if (!Number.isInteger(config.port) || !config.token || config.token.length < 32) {
      throw new Error(`Invalid MC Architect config at ${configPath}`);
    }
    return new MinecraftClient(config as BridgeConfig);
  }

  health(): Promise<unknown> {
    return this.request("GET", "/v1/health", undefined, false);
  }

  context(): Promise<unknown> {
    return this.request("GET", "/v1/context");
  }

  uiState(): Promise<unknown> {
    return this.request("GET", "/v1/ui");
  }

  listWorlds(): Promise<unknown> {
    return this.request("GET", "/v1/worlds");
  }

  openWorld(levelId: string): Promise<unknown> {
    return this.request("POST", "/v1/open-world", { levelId });
  }

  disconnect(): Promise<unknown> {
    return this.request("POST", "/v1/disconnect", {});
  }

  scan(from: Position, to: Position, mode: ScanMode = "summary"): Promise<unknown> {
    return this.request("POST", "/v1/scan", { from, to, mode });
  }

  validateAccess(from: Position, to: Position, start: Position, goals: Position[],
    height = 2, maxStepUp = 1, maxDrop = 1, maxVisited = 100_000): Promise<unknown> {
    return this.request("POST", "/v1/access", {
      from, to, start, goals, height, maxStepUp, maxDrop, maxVisited,
    });
  }

  compareBlueprint(operations: FillOperation[], ignoreState = false, maxDifferences = 128): Promise<unknown> {
    return this.request("POST", "/v1/compare", { operations, ignoreState, maxDifferences });
  }

  apply(operations: FillOperation[], label?: string, projectId?: string, dryRun = false): Promise<unknown> {
    return this.request("POST", "/v1/apply", { operations, label, projectId, dryRun });
  }

  transform(options: TransformOptions): Promise<unknown> {
    return this.request("POST", "/v1/transform", options);
  }

  replace(from: Position, to: Position, match: string[], block: string,
    label?: string, projectId?: string, dryRun = false): Promise<unknown> {
    return this.request("POST", "/v1/replace", { from, to, match, block, label, projectId, dryRun });
  }

  transactions(): Promise<unknown> {
    return this.request("GET", "/v1/transactions");
  }

  startJob(operations: FillOperation[], label?: string, projectId?: string): Promise<unknown> {
    return this.request("POST", "/v1/jobs", { operations, label, projectId });
  }

  jobStatus(): Promise<unknown> {
    return this.request("GET", "/v1/jobs/status");
  }

  controlJob(action: "pause" | "resume" | "cancel", jobId?: string): Promise<unknown> {
    return this.request("POST", "/v1/jobs/control", { action, jobId });
  }

  screenshot(): Promise<ScreenshotResult> {
    return this.request("POST", "/v1/screenshot", {}) as Promise<ScreenshotResult>;
  }

  beginCamera(spectator = true): Promise<unknown> {
    return this.request("POST", "/v1/camera/begin", { spectator });
  }

  moveCamera(position?: CameraPosition, yaw?: number, pitch?: number, fov?: number): Promise<unknown> {
    return this.request("POST", "/v1/camera/move", { position, yaw, pitch, fov });
  }

  restoreCamera(): Promise<unknown> {
    return this.request("POST", "/v1/camera/restore", {});
  }

  fill(from: Position, to: Position, block: string): Promise<unknown> {
    return this.request("POST", "/v1/fill", { from, to, block });
  }

  undo(transactionId?: string, projectId?: string): Promise<unknown> {
    return this.request("POST", "/v1/undo", { transactionId, projectId });
  }

  private async request(method: string, path: string, body?: unknown, authenticate = true): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (authenticate) headers.Authorization = `Bearer ${this.config.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${this.config.port}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new Error("Cannot reach Minecraft. Start the game and open a single-player world.", { cause: error });
    }

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message = typeof data?.error === "string" ? data.error : `HTTP ${response.status}`;
      throw new Error(message);
    }
    return data;
  }
}

function defaultConfigPath(): string {
  if (process.platform === "win32" && process.env.APPDATA) {
    return join(process.env.APPDATA, ".minecraft", "config", "mcarchitect.json");
  }
  return join(homedir(), ".minecraft", "config", "mcarchitect.json");
}
