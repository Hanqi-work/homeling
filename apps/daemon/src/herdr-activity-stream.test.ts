import { expect, test } from "bun:test";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HerdrSocketClient } from "./herdr-client.ts";

test("Herdr stream verifies subscription ack and explicitly scopes supported status events", async () => {
  const root = await mkdtemp(join(tmpdir(), "homeling-event-wire-"));
  const path = join(root, "fake.sock");
  let request: { params: { subscriptions: { type: string; pane_id?: string }[] } } | undefined;
  const server = createServer((socket) => {
    socket.once("data", (chunk) => {
      const body = JSON.parse(chunk.toString()); request = body;
      socket.write(`${JSON.stringify({ id: body.id, result: { type: "subscription_started" } })}\n`);
      socket.end(`${JSON.stringify({ event: "pane_agent_status_changed", data: { pane_id: "p", workspace_id: "s", agent_status: "working" } })}\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  try {
    let up = 0; const events: string[] = []; let downs = 0;
    const ended = Promise.withResolvers<void>();
    const client = new HerdrSocketClient({ socketPath: path, timeoutMs: 100 });
    client.subscribe((event) => events.push(event), () => { downs++; ended.resolve(); }, { paneIds: ["p"], onUp: () => { up++; } });
    await ended.promise;
    expect(request?.params.subscriptions).toContainEqual({ type: "pane.agent_status_changed", pane_id: "p" });
    expect(up).toBe(1);
    expect(events).toEqual(["pane_agent_status_changed"]);
    expect(downs).toBe(1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
