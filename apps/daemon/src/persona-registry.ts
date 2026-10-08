import { mkdir, readFile, writeFile } from "node:fs/promises";
import { renameSync } from "node:fs";
import type { MutationAdmission } from "./session-lock.ts";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { PersonaRecord } from "@homeling/contracts";

export type { PersonaAvatar } from "@homeling/contracts";
export type Persona = PersonaRecord;

export interface ArchivedSpace {
  readonly spaceId: string;
  readonly personaName: string;
  readonly archivedAt: string;
}

export interface OrphanedResource {
  readonly spaceId: string;
  readonly paneId?: string;
  readonly createdAt: string;
  readonly reason: string;
}

interface RegistryFile {
  readonly version: 1;
  readonly personas: readonly Persona[];
  readonly archivedSpaces: readonly ArchivedSpace[];
  readonly orphans: readonly OrphanedResource[];
}

const EMPTY: RegistryFile = { version: 1, personas: [], archivedSpaces: [], orphans: [] };

export class PersonaRegistry {
  private current: RegistryFile | null = null;
  private loading: Promise<RegistryFile> | null = null;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(
    readonly path: string,
    private readonly readRegistry: (path: string) => Promise<string> = (path) => readFile(path, "utf8"),
  ) {}

  async load(): Promise<RegistryFile> {
    if (this.current) return this.current;
    if (!this.loading) this.loading = this.readInitialRegistry();
    const loading = this.loading;
    try { return await loading; }
    finally { if (this.loading === loading) this.loading = null; }
  }

  private async readInitialRegistry(): Promise<RegistryFile> {
    try {
      const parsed = JSON.parse(await this.readRegistry(this.path)) as Partial<RegistryFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.personas)) throw new Error("unsupported registry format");
      this.current = {
        version: 1,
        personas: parsed.personas as Persona[],
        archivedSpaces: Array.isArray(parsed.archivedSpaces) ? parsed.archivedSpaces as ArchivedSpace[] : [],
        orphans: Array.isArray(parsed.orphans) ? parsed.orphans as OrphanedResource[] : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.current = EMPTY;
    }
    return this.current;
  }

  async list(): Promise<readonly Persona[]> {
    await this.writeTail;
    return (await this.load()).personas;
  }

  async get(id: string): Promise<Persona | undefined> {
    await this.writeTail;
    return (await this.load()).personas.find((persona) => persona.id === id);
  }

  async createPersona(persona: Persona, admission?: MutationAdmission): Promise<void> {
    await this.mutate((registry) => {
      if (registry.personas.some((item) => item.id === persona.id)) throw new Error("persona id already exists");
      return { next: { ...registry, personas: [...registry.personas, persona] }, result: undefined };
    }, admission);
  }

  async patchPersona(id: string, patch: Partial<Persona>, admission?: MutationAdmission): Promise<Persona | undefined> {
    return this.mutate((registry) => {
      const current = registry.personas.find((persona) => persona.id === id);
      if (!current) return { next: registry, result: undefined };
      const updated = { ...current, ...patch };
      return {
        next: { ...registry, personas: registry.personas.map((persona) => persona.id === id ? updated : persona) },
        result: updated,
      };
    }, admission);
  }

  async removePersona(id: string, archive: ArchivedSpace): Promise<Persona | undefined> {
    return this.mutate((registry) => {
      const removed = registry.personas.find((persona) => persona.id === id);
      if (!removed) return { next: registry, result: undefined };
      return {
        next: {
          ...registry,
          personas: registry.personas.filter((persona) => persona.id !== id),
          archivedSpaces: [...registry.archivedSpaces.filter((item) => item.spaceId !== archive.spaceId), archive],
        },
        result: removed,
      };
    });
  }

  async addOrphan(orphan: OrphanedResource): Promise<void> {
    await this.mutate((registry) => ({ next: { ...registry, orphans: [...registry.orphans, orphan] }, result: undefined }));
  }

  private mutate<T>(change: (registry: RegistryFile) => { next: RegistryFile; result: T }, admission?: MutationAdmission): Promise<T> {
    const write = this.writeTail.then(async () => {
      admission?.assert();
      const registry = await this.load();
      const changed = change(registry);
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(changed.next, null, 2)}\n`, { mode: 0o600 });
        const commit = () => renameSync(temporary, this.path);
        if (admission) admission.dispatch(commit); else commit();
        this.current = changed.next;
        return changed.result;
      } catch (error) {
        const { rm } = await import("node:fs/promises");
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
    });
    this.writeTail = write.then(() => undefined, () => undefined);
    return write;
  }
}

export function newPersonaId(): string {
  return randomUUID();
}
