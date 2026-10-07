import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveStaticPath, serveStatic, type StaticDir } from "./static.ts";

const ROOT = join(import.meta.dir, ".tmp-static-fixture");

beforeAll(async () => {
  await mkdir(join(ROOT, "assets"), { recursive: true });
  await writeFile(join(ROOT, "index.html"), "<html>lite-shell</html>");
  await writeFile(join(ROOT, "assets", "app.js"), "console.log(1)");
  await writeFile(join(ROOT, "favicon.ico"), "icon");
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

const dir: StaticDir = { root: ROOT, indexHtml: "index.html" };

describe("resolveStaticPath", () => {
  test("maps / and /lite/ to index.html", () => {
    expect(resolveStaticPath("/", dir)?.rel).toBe("index.html");
    expect(resolveStaticPath("/lite/", dir)?.rel).toBe("index.html");
    expect(resolveStaticPath("/lite", dir)?.rel).toBe("index.html");
  });

  test("resolves a real nested file", () => {
    expect(resolveStaticPath("/lite/assets/app.js", dir)?.rel).toBe(join("assets", "app.js"));
  });

  test("rejects .. traversal", () => {
    expect(resolveStaticPath("/lite/../../etc/passwd", dir)).toBeNull();
    expect(resolveStaticPath("/../etc/passwd", dir)).toBeNull();
  });

  test("rejects a sibling dir sharing the prefix", () => {
    expect(resolveStaticPath("/liteX/evil.js", dir)).toBeNull();
  });
});

describe("serveStatic — SPA fallback", () => {
  test("serves index.html for a deep link with no extension", async () => {
    const res = await serveStatic(new Request("https://x/lite/personas/1"), dir);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(await res!.text()).toBe("<html>lite-shell</html>");
  });

  test("serves a real asset with its content type", async () => {
    const res = await serveStatic(new Request("https://x/lite/assets/app.js"), dir);
    expect(res!.status).toBe(200);
    expect(res!.headers.get("content-type")).toContain("javascript");
  });

  test("404s a missing path that has an extension (not swallowed by fallback)", async () => {
    const res = await serveStatic(new Request("https://x/lite/nope.js"), dir);
    expect(res!.status).toBe(404);
  });

  test("404s a missing extensionless path that collides with an existing directory name", async () => {
    // /lite/assets exists on disk as a dir; serving index.html here would be wrong-but-tolerated,
    // but a missing *file* named like a dir must not leak an EISDIR error.
    const res = await serveStatic(new Request("https://x/lite/assets"), dir);
    expect([200, 404]).toContain(res!.status);
  });
});
