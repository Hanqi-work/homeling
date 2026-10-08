import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, parse } from "node:path";

const digest = (secret: string) => createHash("sha256").update("homeling/unlock-verifier/v1\0").update(secret).digest();
function safeAncestors(directory: string): void {
  const absolute = resolve(directory);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split("/").filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error("Unlock directory must not contain symlinks");
  }
}
function safeDirectory(directory: string): void {
  safeAncestors(directory);
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o700) throw new Error("Unlock directory must be owner-only (0700)");
}
function readPrivate(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600 || info.size > 1_024) throw new Error("Unlock file must be owner-only (0600)");
    return readFileSync(fd, "utf8");
  } finally { closeSync(fd); }
}
function exclusiveWrite(path: string, value: string): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); }
}
/** Local operator only. A partial initialization is deliberately not regenerated on daemon restart. */
export function initializeUnlockCredentials(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  safeDirectory(directory);
  const secret = randomBytes(32).toString("base64url");
  exclusiveWrite(join(directory, "unlock-secret"), `${secret}\n`);
  exclusiveWrite(join(directory, "unlock-verifier.json"), `${JSON.stringify({ version: 1, verifier: digest(secret).toString("hex") })}\n`);
}
/** Never reads the plaintext secret. Any unsafe, missing or corrupt state remains unavailable. */
export type UnlockVerifier = ((secret: string) => boolean) & { readonly fingerprint?: string };
export function loadUnlockVerifier(directory: string): UnlockVerifier | null {
  try {
    safeDirectory(directory);
    // Check the plaintext file's metadata, not its contents; missing/unsafe local state is unavailable.
    const info = lstatSync(join(directory, "unlock-secret"));
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600) return null;
    const state = JSON.parse(readPrivate(join(directory, "unlock-verifier.json"))) as { version?: unknown; verifier?: unknown };
    if (state.version !== 1 || typeof state.verifier !== "string" || !/^[a-f0-9]{64}$/.test(state.verifier)) return null;
    const expected = Buffer.from(state.verifier, "hex");
    return Object.assign((secret: string) => /^[A-Za-z0-9_-]{43}$/.test(secret) && timingSafeEqual(digest(secret), expected), { fingerprint: state.verifier });
  } catch { return null; }
}
