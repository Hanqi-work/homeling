import { expect, test } from "bun:test";
import { LocalePreferenceController } from "./locale-preference.ts";
import { ClientSessionLocked } from "./session-state.ts";

test("leaving the locale provider invalidates pending reads and cannot start a late preference write or publish after cleanup", async () => {
  const release = Promise.withResolvers<void>(); let writes = 0, publications = 0;
  const controller = new LocalePreferenceController("en", { admit: () => () => {}, sync: async (_locale, check) => { await release.promise; check(); writes++; return "synced"; } }, () => { publications++; });
  const pending = controller.select("de"); controller.deactivate();
  const before = publications; release.resolve(); await pending;
  expect(writes).toBe(0); expect(publications).toBe(before);
});
test("explicit choice syncs once, and a locked or unknown result stays unsynced until an explicit retry", async () => {
  let locked = true, calls = 0;
  const controller = new LocalePreferenceController("en", { admit: () => { if (locked) throw new ClientSessionLocked(); return () => { if (locked) throw new ClientSessionLocked(); }; }, sync: async (_locale, check) => { check(); calls++; if (calls === 1) throw new Error("lost response"); return "synced"; } }, () => {});
  await controller.select("de");
  expect(controller.get().phase).toBe("unsynced"); expect(calls).toBe(0);
  locked = false;
  expect(calls).toBe(0);
  await controller.retry();
  expect(controller.get().phase).toBe("unsynced"); expect(calls).toBe(1);
  await controller.retry();
  expect(controller.get().phase).toBe("synced"); expect(calls).toBe(2);
});
test("a newer choice cannot be overwritten by late completion, queued or replayed automatically", async () => {
  const release = Promise.withResolvers<void>(); const values: string[] = [];
  const controller = new LocalePreferenceController("en", { admit: () => () => {}, sync: async (locale, check) => { values.push(locale); await release.promise; check(); return "synced"; } }, () => {});
  const first = controller.select("de");
  await controller.select("ja");
  expect(controller.get().phase).toBe("unsynced"); expect(values).toEqual(["de"]);
  release.resolve(); await first;
  expect(controller.get().phase).toBe("unsynced"); expect(values).toEqual(["de"]);
  await controller.retry();
  expect(values).toEqual(["de", "ja"]); expect(controller.get().phase).toBe("synced");
});
