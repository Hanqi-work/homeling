import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

/** Exercise the shipped classic worker, not a second implementation of its policy. */
async function worker() {
  const handlers = new Map<string, (event: any) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const fetched: string[] = [], deleted: string[] = [];
  let offline = false, status = 200, claimed = 0, skipped = 0, cacheWriteFailed = false;
  const key = (input: string | { url: string }) => typeof input === "string" ? input : input.url;
  const cache = (name: string) => {
    let data = stores.get(name); if (!data) { data = new Map(); stores.set(name, data); }
    return {
      addAll: async (urls: string[]) => { for (const url of urls) data!.set(url, new Response("shell")); },
      put: async (input: string | { url: string }, response: Response) => { if (cacheWriteFailed) throw new Error("cache quota refused"); data!.set(key(input), response); },
      match: async (input: string | { url: string }) => data!.get(key(input))?.clone(),
    };
  };
  const caches = {
    open: async (name: string) => cache(name), keys: async () => [...stores.keys()],
    delete: async (name: string) => { deleted.push(name); return stores.delete(name); },
    match: async (input: string | { url: string }) => { for (const data of stores.values()) { const result = data.get(key(input)); if (result) return result.clone(); } },
  };
  const self = { location: { origin: "https://home.example" }, addEventListener: (name: string, handler: (event: any) => void) => handlers.set(name, handler), skipWaiting: async () => { skipped++; }, clients: { claim: async () => { claimed++; } } };
  runInNewContext(await readFile(new URL("../../public/sw.js", import.meta.url), "utf8"), {
    self, URL, Response, caches, fetch: async (request: { url: string }) => { fetched.push(request.url); if (offline) throw new Error("offline"); return new Response("network", { status }); },
  });
  async function lifecycle(name: string) { let work = Promise.resolve(); handlers.get(name)!({ waitUntil: (next: Promise<void>) => { work = next; } }); await work; }
  async function request(path: string, mode = "same-origin") {
    let response: Promise<Response> | undefined;
    handlers.get("fetch")!({ request: { url: new URL(path, self.location.origin).href, mode, method: "GET" }, respondWith: (next: Promise<Response>) => { response = next; } });
    return response ? await response : undefined;
  }
  return { stores, fetched, deleted, lifecycle, request, setOffline(value: boolean) { offline = value; }, setStatus(value: number) { status = value; }, setCacheWriteFailure() { cacheWriteFailed = true; }, claimed: () => claimed, skipped: () => skipped };
}

test("actual worker bypasses API even for navigation, other origins and unowned paths", async () => {
  const w = await worker();
  for (const path of ["/api/snapshot", "/lite/api/health"]) for (const mode of ["navigate", "same-origin"]) expect(await w.request(path, mode)).toBeUndefined();
  for (const path of ["https://cdn.example/lite/assets/app.js", "/favicon.ico", "/liteevil/app.js"]) expect(await w.request(path)).toBeUndefined();
  expect(w.fetched).toEqual([]); expect(w.stores.size).toBe(0);
});

test("actual install precaches the shell and activation preserves only current owned caches and unrelated Collie caches", async () => {
  const w = await worker(); await w.lifecycle("install");
  expect(w.skipped()).toBe(1);
  const shellName = [...w.stores.keys()][0]!;
  expect([...w.stores.get(shellName)!.keys()]).toEqual(["/lite/", "/lite/index.html"]);
  await w.request("/lite/persona/p1", "navigate");
  const currentNames = [...w.stores.keys()];
  w.stores.set("homeling-lite-shell-obsolete", new Map()); w.stores.set("collie-shell", new Map());
  await w.lifecycle("activate");
  expect(w.deleted).toEqual(["homeling-lite-shell-obsolete"]);
  for (const name of [...currentNames, "collie-shell"]) expect(w.stores.has(name)).toBe(true);
  expect(w.claimed()).toBe(1);
});

test("actual worker serves build assets cache-first and deep links network-first with offline shell fallback", async () => {
  const w = await worker(); await w.lifecycle("install");
  expect(await (await w.request("/lite/assets/app.js"))!.text()).toBe("network");
  w.setOffline(true);
  expect(await (await w.request("/lite/assets/app.js"))!.text()).toBe("network");
  expect(w.fetched).toHaveLength(1);
  expect(await (await w.request("/lite/persona/p1", "navigate"))!.text()).toBe("shell");
  w.setOffline(false);
  expect(await (await w.request("/lite/persona/p1", "navigate"))!.text()).toBe("network");
  w.setOffline(true);
  expect(await (await w.request("/lite/persona/p2", "navigate"))!.text()).toBe("network");
});

test.each([["/lite/persona/p1", "navigate"], ["/lite/assets/app.js", "same-origin"]])("actual worker preserves a successful network response when cache.put rejects for %s", async (path, mode) => {
  const w = await worker(); await w.lifecycle("install"); w.setCacheWriteFailure();
  const response = await w.request(path!, mode);
  expect(response!.status).toBe(200); expect(await response!.text()).toBe("network");
});

test("actual worker never replaces an offline shell with a failed HTTP navigation", async () => {
  const w = await worker(); await w.lifecycle("install"); w.setStatus(502);
  expect((await w.request("/lite/persona/p1", "navigate"))!.status).toBe(502);
  w.setOffline(true);
  expect(await (await w.request("/lite/persona/p2", "navigate"))!.text()).toBe("shell");
});
