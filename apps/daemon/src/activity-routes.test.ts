import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityLedger } from "./activity-ledger.ts";
import { daemonConfigFromEnv } from "./config.ts";
import { handleRequest } from "./index.ts";
import { PersonaRegistry } from "./persona-registry.ts";
import type { PersonaRuntime } from "./persona-service.ts";
import { SessionLock } from "./session-lock.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

test("authenticated Activity API reads durable history without triggering Herdr or recovery writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "homeling-activity-api-")); roots.push(root);
  const cfg = daemonConfigFromEnv({ HOMELING_REGISTRY_PATH: join(root, "registry.json"), HOMELING_WEB_DIST: root });
  const activity = new ActivityLedger(join(root, "activity.json"));
  const session = new SessionLock(); const { token } = session.unlock("test");
  const occurrence = await activity.register({ personaId: "a", spaceId: "s", paneId: "p", title: "Build" }, session.admission(session.admit(token, "test")));
  const unavailable = (): never => { throw new Error("Herdr must not be called by Activity GET"); };
  const runtime: PersonaRuntime = { cfg, registry: new PersonaRegistry(cfg.registryPath), activity, herdr: { createSpace: unavailable, createTab: unavailable, readPane: unavailable, sendText: unavailable, sendKeys: unavailable, closePane: unavailable, renameSpace: unavailable, snapshot: unavailable, subscribe: unavailable }, fetcher: async () => { throw new Error("Bridge must not be called"); } };
  const req = (path: string, remoteAddress = "127.0.0.1") => Object.assign(new Request(`http://localhost:8790${path}`, { headers: { host: "localhost:8790" } }), { remoteAddress });
  const response = await handleRequest(req("/lite/api/persona/a/activity"), cfg, runtime.fetcher, runtime);
  expect(response.status).toBe(200);
  expect((await response.json()).events[0].kind).toBe("task.created");
  const detail = await handleRequest(req(`/lite/api/activity/task/${occurrence.occurrenceKey}`), cfg, runtime.fetcher, runtime);
  expect(await detail.json()).toMatchObject({ occurrence: { paneId: "p", occurrenceKey: occurrence.occurrenceKey }, current: true });
  const absent = await handleRequest(req("/lite/api/persona/b/activity"), cfg, runtime.fetcher, runtime);
  expect(absent.status).toBe(404);
  const denied = await handleRequest(req("/lite/api/persona/a/activity", "192.168.1.2"), cfg, runtime.fetcher, runtime);
  expect(denied.status).toBe(401);
});
