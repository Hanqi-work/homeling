import { expect, test } from "bun:test";
import { syncPushLocale, type PushLocaleDependencies } from "./push-client.ts";
import { ClientSessionLocked } from "./session-state.ts";

function dependencies() {
  const calls: unknown[] = [];
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/existing" };
  const registration = { scope: "https://home.example/lite/", active: {}, pushManager: { getSubscription: async () => subscription, subscribe: async () => { throw new Error("must never allocate a subscription"); } } } as unknown as ServiceWorkerRegistration;
  const deps: PushLocaleDependencies = { origin: () => "https://home.example", getRegistration: async () => registration, getStatus: async () => ({ publicKey: "public", preferences: { enabled: false }, subscriptions: [{ endpoint: subscription.endpoint, locale: "en" }] }), update: async (endpoint, locale) => { calls.push({ endpoint, locale }); return { ok: true, locale }; } };
  return { deps, calls, registration };
}
test("explicit locale sync reads the existing exact worker and updates only endpoint plus locale", async () => {
  const { deps, calls } = dependencies();
  expect(await syncPushLocale("de", () => {}, deps)).toBe("synced");
  expect(calls).toEqual([{ endpoint: "https://fcm.googleapis.com/fcm/send/existing", locale: "de" }]);
});
test.each(["registration", "subscription", "status", "response"] as const)("a lost original lease at %s cannot be retried or marked synced", async (boundary) => {
  const { deps, calls, registration } = dependencies(); let locked = false;
  const check = () => { if (locked) throw new ClientSessionLocked(); };
  if (boundary === "registration") deps.getRegistration = async () => { locked = true; return registration; };
  if (boundary === "subscription") registration.pushManager.getSubscription = async () => { locked = true; return { endpoint: "endpoint" } as PushSubscription; };
  if (boundary === "status") deps.getStatus = async () => { locked = true; return { publicKey: "public", preferences: { enabled: false }, subscriptions: [] }; };
  if (boundary === "response") deps.update = async () => { locked = true; calls.push("already dispatched"); return { ok: true, locale: "de" }; };
  await expect(syncPushLocale("de", check, deps)).rejects.toBeInstanceOf(ClientSessionLocked);
  expect(calls.length).toBe(boundary === "response" ? 1 : 0);
});
