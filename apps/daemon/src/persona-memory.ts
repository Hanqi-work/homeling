import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import type { MutationAdmission } from "./session-lock.ts";

export const MEMORY_KINDS = ["facts", "preferences", "project"] as const;
export type MemoryKind = typeof MEMORY_KINDS[number];
export const MEMORY_MAX_BYTES = 24_000;
export interface MemoryDocument { readonly content: string; readonly revision: string }
export interface PersonaMemory { readonly documents: Record<MemoryKind, MemoryDocument>; readonly effective: "next-session" }
export class MemoryError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
const fail = (message: string): never => { throw new MemoryError("memory.unsafe", 400, message); };
const revision = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function checkId(id: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) fail("Invalid persona id");
}
function checkPath(path: string, privatePath = false): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("Memory directory must not be a symlink");
  if (privatePath && (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)) fail("Memory directory must be owner-only (0700)");
}
function checkAncestors(path: string): void {
  const parent = dirname(path);
  if (parent !== path) checkAncestors(parent);
  if (existsSync(path)) checkPath(path);
  else { try { lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; } fail("Unsafe memory directory"); }
}
function encode(content: string, maxBytes = MEMORY_MAX_BYTES): Buffer {
  // JSON may contain lone surrogates, which UTF-8 encoding would silently replace.
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(content) || content.includes("\0")) fail("Memory must be valid UTF-8 text without NUL");
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length > maxBytes) throw new MemoryError("memory.too_large", 413, `Memory text exceeds ${maxBytes} UTF-8 bytes`);
  return bytes;
}

/** Fixed Markdown names, owner-only storage, strict UTF-8, optimistic concurrency, atomic replacement. */
export class PersonaMemoryStore {
  readonly root: string;
  constructor(root: string) {
    if (!isAbsolute(root) || resolve(root) === parse(root).root) fail("Memory root must be a dedicated absolute directory");
    this.root = resolve(root);
  }
  private directory(id: string): string {
    checkId(id);
    checkAncestors(this.root);
    if (existsSync(this.root)) checkPath(this.root, true);
    const directory = join(this.root, id);
    if (existsSync(directory)) checkPath(directory, true);
    else { try { lstatSync(directory); fail("Unsafe persona directory"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
    return directory;
  }
  private document(directory: string, kind: MemoryKind): MemoryDocument {
    let fd: number;
    try { fd = openSync(join(directory, `${kind}.md`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { content: "", revision: revision(Buffer.alloc(0)) };
      throw new MemoryError("memory.unsafe", 400, "Memory file could not be safely opened");
    }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) fail("Memory file must be an owner-only regular file");
      if (stat.size > MEMORY_MAX_BYTES) throw new MemoryError("memory.too_large", 413, "Memory file is too large");
      const bytes = readFileSync(fd);
      if (bytes.length > MEMORY_MAX_BYTES) throw new MemoryError("memory.too_large", 413, "Memory file is too large");
      let content: string;
      try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { fail("Memory file contains invalid UTF-8"); }
      if (content!.includes("\0")) fail("Memory file contains NUL");
      return { content: content!, revision: revision(bytes) };
    } finally { closeSync(fd); }
  }
  private snapshot(id: string): PersonaMemory {
    const directory = this.directory(id);
    return { documents: Object.fromEntries(MEMORY_KINDS.map(kind => [kind, this.document(directory, kind)])) as Record<MemoryKind, MemoryDocument>, effective: "next-session" };
  }
  async read(id: string): Promise<PersonaMemory> { return this.snapshot(id); }
  async save(id: string, kind: MemoryKind, content: string, expectedRevision: string, admission: MutationAdmission): Promise<PersonaMemory> {
    admission.assert();
    if (!MEMORY_KINDS.includes(kind)) fail("Invalid memory document");
    const bytes = encode(content);
    const directory = this.directory(id);
    const rootExisted = existsSync(this.root), directoryExisted = existsSync(directory);
    const lock = join(directory, ".write-lock");
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    let ownsLock = false, committed = false;
    try {
      admission.dispatch(() => { mkdirSync(this.root, { recursive: true, mode: 0o700 }); mkdirSync(directory, { recursive: true, mode: 0o700 }); });
      checkPath(this.root, true); checkPath(directory, true);
      try { admission.dispatch(() => mkdirSync(lock, { mode: 0o700 })); ownsLock = true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new MemoryError("memory.busy", 409, "Memory write in progress; reload before retrying"); throw error; }
      const before = this.snapshot(id);
      if (before.documents[kind].revision !== expectedRevision) throw new MemoryError("memory.conflict", 409, "Memory changed; reload before saving");
      admission.dispatch(() => {
        const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
      });
      // Actual irreversible commit, not merely the asynchronous save entrypoint.
      admission.dispatch(() => renameSync(temporary, join(directory, `${kind}.md`)));
      committed = true;
      return { ...before, documents: { ...before.documents, [kind]: { content, revision: revision(bytes) } } };
    } finally {
      rmSync(temporary, { force: true });
      if (ownsLock) rmdirSync(lock);
      if (!committed) {
        // Only remove newly-created empty directories; never reclaim somebody else's lock/data.
        for (const path of [...(!directoryExisted ? [directory] : []), ...(!rootExisted ? [this.root] : [])]) {
          try { rmdirSync(path); } catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
        }
      }
    }
  }
  async freeze(id: string, content: string, admission: MutationAdmission): Promise<string> {
    admission.assert(); checkId(id);
    const bytes = encode(content, 150_000);
    const directory = this.directory(id);
    const path = join(directory, `session-${randomUUID()}.md`);
    admission.dispatch(() => {
      mkdirSync(this.root, { recursive: true, mode: 0o700 }); mkdirSync(directory, { recursive: true, mode: 0o700 });
      checkPath(this.root, true); checkPath(directory, true);
      const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    });
    return path;
  }
}
