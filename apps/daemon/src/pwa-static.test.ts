import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serveStatic, type StaticDir } from "./static.ts";

const ROOT = join(import.meta.dir, ".tmp-pwa-static-fixture");

beforeAll(async () => {
  await mkdir(join(ROOT, "icons"), { recursive: true });
  await writeFile(join(ROOT, "index.html"), "<html>lite-shell</html>");
  await writeFile(join(ROOT, "sw.js"), "self.addEventListener('fetch', () => {})");
  await writeFile(join(ROOT, "manifest.webmanifest"), '{"name":"Homeling"}');
  await writeFile(join(ROOT, "icons", "icon-192.png"), "png");
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

const DIR: StaticDir = { root: ROOT, indexHtml: "index.html" };

function get(path: string): Promise<Response> {
  return serveStatic(new Request(`https://node.ts.net${path}`), DIR) as Promise<Response>;
}

describe("static hosting of PWA assets under /lite/", () => {
  test("sw.js is served from /lite/sw.js with a JS content type", async () => {
    const res = await get("/lite/sw.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(await res.text()).toContain("addEventListener");
  });

  test("manifest.webmanifest is served with the application/manifest+json type", async () => {
    const res = await get("/lite/manifest.webmanifest");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/manifest+json");
    expect(await res.text()).toContain("Homeling");
  });

  test("icons under /lite/icons/ are served as PNG", async () => {
    const res = await get("/lite/icons/icon-192.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  test("no Service-Worker-Allowed header is needed (worker lives inside its own scope)", async () => {
    const res = await get("/lite/sw.js");
    // The spec: a SW at /lite/sw.js gets scope /lite/ by default. Absence of the header is fine;
    // this test just pins that we serve the file at all.
    expect(res.status).toBe(200);
  });
});
