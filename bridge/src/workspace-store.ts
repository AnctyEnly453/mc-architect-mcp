import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { moduleSchema, resolveWorkspace, type Workspace } from "./workspace-model.js";

export type Revision = { revision: number; id: string; parent?: string; createdAt: string; message: string; source: Workspace };
export async function atomicJSON(path: string, value: unknown) {
  const temporary = path + "." + randomUUID() + ".tmp";
  const file = await open(temporary, "wx");
  try { await file.writeFile(JSON.stringify(value, null, 2) + "\n", "utf8"); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
}
export class WorkspaceStore {
  readonly directory: string;
  constructor(directory: string) { this.directory = resolve(directory); }
  async read(): Promise<Revision> {
    const head = JSON.parse(await readFile(join(this.directory, "HEAD.json"), "utf8"));
    return this.revision(head.id);
  }
  async revision(id: string): Promise<Revision> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid revision handle");
    return JSON.parse(await readFile(join(this.directory, "revisions", `${id}.json`), "utf8"));
  }
  async history(limit = 20) {
    const result = []; let current: Revision | undefined = await this.read();
    while (current && result.length < limit) {
      const { source, ...summary } = current; result.push(summary);
      current = current.parent ? await this.revision(current.parent) : undefined;
    }
    return result;
  }
  async create(input: unknown) {
    return this.lock(async () => {
      try { await this.read(); throw new Error("Workspace already exists"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      return this.commit(resolveWorkspace(input).source, "Import project");
    });
  }
  async edit(expectedRevision: number, input: { moduleId?: string; module?: unknown; remove?: boolean; source?: unknown; restoreRevision?: string; message?: string }) {
    return this.lock(async () => {
      const previous = await this.read();
      if (previous.revision !== expectedRevision) throw new Error(`Stale edit: expected r${expectedRevision}, current r${previous.revision}`);
      let source = structuredClone(previous.source);
      if (input.source) source = resolveWorkspace(input.source).source;
      else if (input.restoreRevision) source = (await this.revision(input.restoreRevision)).source;
      else {
        if (!input.moduleId) throw new Error("moduleId is required for a module edit");
        const index = source.modules.findIndex(m => m.id === input.moduleId);
        if (input.remove) {
          if (index < 0) throw new Error("Unknown module");
          source.modules.splice(index, 1);
        } else {
          const module = moduleSchema.parse(input.module);
          if (module.id !== input.moduleId) throw new Error("Module ID differs from edit target");
          if (index < 0) source.modules.push(module); else source.modules[index] = module;
        }
      }
      if (source.worldId !== previous.source.worldId || source.dimension !== previous.source.dimension || source.projectId !== previous.source.projectId) {
        throw new Error("Project identity is immutable; create a separate workspace to target another world");
      }
      return this.commit(resolveWorkspace(source).source, input.message ?? `Edit ${input.moduleId ?? "project"}`, previous);
    });
  }
  async summary() {
    const head = await this.read(), model = resolveWorkspace(head.source);
    return { directory: this.directory, revision: head.revision, revisionId: head.id, name: head.source.name,
      projectId: head.source.projectId, worldId: head.source.worldId, dimension: head.source.dimension,
      modules: model.modules, ports: model.ports, connections: model.connections, stages: model.stages,
      bounds: model.bounds, history: await this.history(), sourcePath: join(this.directory, "revisions", `${head.id}.json`) };
  }
  private async commit(source: Workspace, message: string, previous?: Revision) {
    const revision: Revision = { revision: (previous?.revision ?? 0) + 1, id: randomUUID(), parent: previous?.id,
      createdAt: new Date().toISOString(), message, source };
    await mkdir(join(this.directory, "revisions"), { recursive: true });
    await atomicJSON(join(this.directory, "revisions", `${revision.id}.json`), revision);
    await atomicJSON(join(this.directory, "HEAD.json"), { id: revision.id, revision: revision.revision });
    return { directory: this.directory, revision: revision.revision, revisionId: revision.id };
  }
  async lock<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, ".workspace.lock");
    let handle;
    try { handle = await open(path, "wx"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Workspace is locked: ${path}. If its recorded process exited, remove the stale lock before retrying.`);
      throw error;
    }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); return await action(); }
    finally { await handle.close(); await unlink(path); }
  }
}
