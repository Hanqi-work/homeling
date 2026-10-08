import { describe, expect, test } from "bun:test";
import { startSerialPolling } from "./polling.ts";

async function flushMicrotasks() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("startSerialPolling", () => {
  test("waits for a slow request to settle before scheduling the next poll", async () => {
    let finishFirst!: () => void;
    let calls = 0;
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    const poll = () => {
      calls += 1;
      if (calls === 1) return new Promise<void>((resolve) => { finishFirst = resolve; });
      return Promise.resolve();
    };
    const stop = startSerialPolling(poll, 3000, (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    }, () => {});

    await flushMicrotasks();
    expect(calls).toBe(1);
    expect(scheduled).toHaveLength(0);
    finishFirst();
    await flushMicrotasks();
    expect(scheduled.map((timer) => timer.delay)).toEqual([3000]);

    scheduled.shift()?.callback();
    await Promise.resolve();
    expect(calls).toBe(2);
    stop();
  });

  test("stopping cancels a pending poll", async () => {
    let cancelled = -1;
    const scheduled: Array<() => void> = [];
    const stop = startSerialPolling(async () => {}, 2000, (callback) => {
      scheduled.push(callback);
      return 7;
    }, (timer) => { cancelled = timer; });
    await flushMicrotasks();

    stop();
    expect(cancelled).toBe(7);
    scheduled[0]?.();
    await Promise.resolve();
    expect(scheduled).toHaveLength(1);
  });
});
