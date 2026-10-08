import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, chmodSync, realpathSync, symlinkSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeUnlockCredentials, loadUnlockVerifier, rotateUnlockCredentials } from "./unlock-credentials.ts";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
test("explicit local rotation atomically publishes a new matching verifier without logging the secret", () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "homeling-rotate-")); dirs.push(root);
  const dir = join(root, "state"); initializeUnlockCredentials(dir);
  const oldSecret = readFileSync(join(dir, "unlock-secret"), "utf8").trim();
  const oldFingerprint = loadUnlockVerifier(dir)!.fingerprint;
  rotateUnlockCredentials(dir);
  const nextSecret = readFileSync(join(dir, "unlock-secret"), "utf8").trim();
  expect(nextSecret).not.toBe(oldSecret);
  const verifier = loadUnlockVerifier(dir)!;
  expect(verifier.fingerprint).not.toBe(oldFingerprint);
  expect(verifier(oldSecret)).toBe(false); expect(verifier(nextSecret)).toBe(true);
});

test("symlink paths and an interrupted rotation remain unavailable without creating or regenerating state", () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "homeling-unsafe-")); dirs.push(root);
  const link = join(root, "link"); symlinkSync(join(root, "absent"), link);
  expect(() => initializeUnlockCredentials(join(link, "state"))).toThrow();
  expect(existsSync(join(root, "absent"))).toBe(false);
  const dir = join(root, "state"); initializeUnlockCredentials(dir);
  const before = readFileSync(join(dir, "unlock-secret"), "utf8");
  writeFileSync(join(dir, ".unlock-rotation-pending"), "partial", { mode: 0o600 });
  expect(loadUnlockVerifier(dir)).toBeNull();
  expect(() => rotateUnlockCredentials(dir)).toThrow();
  expect(() => initializeUnlockCredentials(dir)).toThrow();
  expect(readFileSync(join(dir, "unlock-secret"), "utf8")).toBe(before);
});

test("local exclusive initialization persists owner-only secret and a domain-separated verifier; runtime reads no plaintext", () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "homeling-lock-")); dirs.push(root);
  const dir = join(root, "state");
  initializeUnlockCredentials(dir);
  const secret = readFileSync(join(dir, "unlock-secret"), "utf8").trim();
  expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(statSync(dir).mode & 0o777).toBe(0o700);
  expect(statSync(join(dir, "unlock-secret")).mode & 0o777).toBe(0o600);
  const verify = loadUnlockVerifier(dir)!;
  expect(verify(secret)).toBe(true);
  expect(verify("wrong")).toBe(false);
  expect(() => initializeUnlockCredentials(dir)).toThrow();
  expect(loadUnlockVerifier(join(root, "missing"))).toBeNull();
  chmodSync(join(dir, "unlock-verifier.json"), 0o644);
  expect(loadUnlockVerifier(dir)).toBeNull();
});
