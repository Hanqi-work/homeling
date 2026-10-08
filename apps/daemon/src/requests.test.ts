import { describe, expect, test } from "bun:test";
import { approvePendingRequest, collectPendingRequests, detectPendingRequest, PendingRequestStore } from "./requests.ts";
import { daemonConfigFromEnv } from "./config.ts";
import type { BridgeFetch } from "./bridge-proxy.ts";
import type { PaneWire } from "@homeling/contracts";

const permissionScreen = `───────
Bash command

  mkfifo fixture-fifo
  Create a named pipe (FIFO)

This command requires approval

Do you want to proceed?
❯ 1. Yes
  2. Yes, and don’t ask again for: mkfifo fixture-fifo *
  3. No

Esc to cancel · Tab to amend · ctrl+e to explain`;

const previewScreen = `Use the AskUserQuestion tool to ask one question
──────────────
 ☐ Design

Which widget design should we use?
❯ 1. Boxy                         ┌──────────────────────┐
  2. Rounded                      │ rounded mockup       │
  3. Minimal                      └──────────────────────┘
                                  │ more preview         │
                                  Notes: press n to add notes
──────────────
  Chat about this
Enter to select · ↑/↓ to navigate · n to add notes · Esc to cancel`;

const pane: PaneWire = {
  paneId: "w1:p2", workspaceId: "w1", workspaceLabel: "Work", workspaceNumber: 1,
  tabId: "w1:t1", agent: "claude", status: "blocked", cwd: "/work", focused: true,
};

// Mirrors the protocol boundary in Collie bridge/prompt-binding.ts: expected text is SGR-stripped,
// trailing spaces/blank rows are ignored, indentation is significant, and the match must be in tail.
function verifyExpectedPrompt(freshText: string, expected: string): boolean {
  const esc = String.fromCodePoint(0x1b);
  const sgr = new RegExp(`${esc}\\[[0-?]*[ -/]*m`, "g");
  const normalize = (text: string) => text
    .replace(sgr, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.length > 0);
  const fresh = normalize(freshText);
  const wanted = normalize(expected);
  if (!wanted.length) return false;
  for (let start = 0; start <= fresh.length - wanted.length; start++) {
    if (wanted.every((line, offset) => fresh[start + offset] === line)) {
      return start + wanted.length - 1 >= Math.max(0, fresh.length - 6);
    }
  }
  return false;
}

describe("pending request extraction", () => {
  test("extracts a real-shaped permission prompt and its selectable choices", () => {
    const detected = detectPendingRequest(permissionScreen);
    expect(detected?.kind).toBe("prompt-select");
    expect(detected?.question).toBe("Do you want to proceed?");
    expect(detected?.subject).toContain("Bash command");
    expect(detected?.subject).toContain("mkfifo fixture-fifo");
    expect(detected?.options.map(({ label, keys }) => ({ label, keys }))).toEqual([
      { label: "Yes", keys: ["1"] },
      { label: "Yes, and don’t ask again for: mkfifo fixture-fifo *", keys: ["2"] },
      { label: "No", keys: ["3"] },
    ]);
  });

  test("strips terminal SGR sequences before extracting a live prompt", () => {
    const esc = String.fromCodePoint(0x1b);
    const colored = permissionScreen.replace("❯ 1. Yes", `${esc}[38;2;177;185;249m❯ 1. Yes${esc}[0m`);
    expect(detectPendingRequest(colored)?.options[0]?.label).toBe("Yes");
  });

  test("extracts preview-select content and Enter choreography from a real-shaped dialog", () => {
    const detected = detectPendingRequest(previewScreen);
    expect(detected?.kind).toBe("preview-select");
    expect(detected?.question).toBe("Which widget design should we use?");
    expect(detected?.options).toHaveLength(3);
    expect(detected?.options[0]?.keys).toEqual(["1", "Enter"]);
    expect(detected?.preview.join(" ")).toContain("rounded mockup");
  });

  test("real Collie permission fixtures preserve binding indentation", async () => {
    for (const name of ["permission-bash-v2291-w82.txt", "permission-write-v2291-w82.txt"]) {
      const text = await Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text();
      const detected = detectPendingRequest(text);
      expect(detected?.kind).toBe("prompt-select");
      expect(detected?.signature.startsWith(" ")).toBe(true);
      expect(verifyExpectedPrompt(text, detected!.signature)).toBe(true);
    }
  });

  test("recognizes real plan and footerless WebFetch prompts without making feedback an action", async () => {
    const plan = await Bun.file(new URL("./fixtures/plan-approval-v2291-w82.txt", import.meta.url)).text();
    const focusedPlan = await Bun.file(new URL("./fixtures/plan-feedback-focused.txt", import.meta.url)).text();
    const typedFocusedPlan = await Bun.file(new URL("./fixtures/plan-feedback-typed-focused.txt", import.meta.url)).text();
    const focusedPreview = await Bun.file(new URL("./fixtures/preview-notes-focused.txt", import.meta.url)).text();
    const focusedAskInput = await Bun.file(new URL("./fixtures/ask-type-something-focused.txt", import.meta.url)).text();
    const focusedMultiInput = await Bun.file(new URL("./fixtures/multiselect-type-something-focused.txt", import.meta.url)).text();
    const webFetch = await Bun.file(new URL("./fixtures/permission-webfetch-v2291-w82.txt", import.meta.url)).text();
    const planRequest = detectPendingRequest(plan);
    const webFetchRequest = detectPendingRequest(webFetch);
    expect(planRequest?.kind).toBe("prompt-select");
    expect(planRequest?.options.map((option) => option.label)).toContain("Yes, and use auto mode");
    expect(planRequest?.options.map((option) => option.label)).not.toContain("Tell Claude what to change");
    expect(verifyExpectedPrompt(plan, planRequest!.signature)).toBe(true);
    expect(detectPendingRequest(focusedPlan)).toBeNull();
    expect(detectPendingRequest(typedFocusedPlan)).toBeNull();
    expect(detectPendingRequest(focusedPreview)).toBeNull();
    expect(detectPendingRequest(focusedAskInput)).toBeNull();
    expect(detectPendingRequest(focusedMultiInput)).toBeNull();
    expect(detectPendingRequest(focusedAskInput)).toBeNull();
    expect(detectPendingRequest(focusedMultiInput)).toBeNull();
    expect(webFetchRequest?.kind).toBe("prompt-select");
    const webFetchLastOption = webFetchRequest?.options[webFetchRequest.options.length - 1]?.label;
    expect(webFetchLastOption).toMatch(/^No,/);
    expect(verifyExpectedPrompt(webFetch, webFetchRequest!.signature)).toBe(true);
    expect(detectPendingRequest(`${webFetch}\n● Done`)).toBeNull();
    expect(detectPendingRequest(`${webFetch}\n● Done\n  1. Yes\n  2. No`)).toBeNull();
    expect(detectPendingRequest(webFetch.replaceAll("❯", ""))).toBeNull();
  });

  test("long operation bodies outside the Collie binding window still change request identity", () => {
    const comments = Array.from({ length: 50 }, (_, index) => `same safe-looking comment ${index + 1}`).join("\n");
    const screen = (command: string) => `Bash command\n${command}\n${comments}\nDo you want to proceed?\n❯ 1. Yes\n  2. No\n\nEsc to cancel · Tab to amend`;
    const safe = detectPendingRequest(screen("touch safe"))!;
    const destructive = detectPendingRequest(screen("rm -rf data"))!;
    expect(safe.signature).not.toBe(destructive.signature);
    expect(safe.identity).not.toBe(destructive.identity);
    expect(safe.subject.join(" ")).toContain("touch safe");
    expect(destructive.subject.join(" ")).toContain("rm -rf data");

    const store = new PendingRequestStore();
    const first = store.observe(pane, safe, 1000)!;
    const replacement = store.observe(pane, destructive, 2000)!;
    expect(replacement.id).not.toBe(first.id);
    expect(store.find(first.id)?.request.status).toBe("expired");
  });

  test("different real Bash operation bodies never reuse a stale request id", async () => {
    const bash = await Bun.file(new URL("./fixtures/permission-bash-v2291-w82.txt", import.meta.url)).text();
    const write = await Bun.file(new URL("./fixtures/permission-write-v2291-w82.txt", import.meta.url)).text();
    const store = new PendingRequestStore();
    const first = store.observe(pane, detectPendingRequest(bash), 1000)!;
    const second = store.observe(pane, detectPendingRequest(write), 2000)!;
    expect(second.id).not.toBe(first.id);
    expect(store.find(first.id)?.request.status).toBe("expired");
    expect(store.find(second.id)?.request.status).toBe("pending");
    expect(first.kind === "prompt-select" && first.payload.subject?.join(" ")).toContain("touch /tmp/claude-lab/project/scratch-one.txt");
  });

  test("fails closed on incomplete or non-numbered screens", () => {
    expect(detectPendingRequest("Do you want to proceed?\n❯ Allow\nNo" )).toBeNull();
    expect(detectPendingRequest(permissionScreen.replace("Do you want to proceed?", "Proceed?" ).replace("  3. No", "  4. No"))).toBeNull();
  });

  test("reuses one request id per unchanged display and expires replaced displays", () => {
    const store = new PendingRequestStore();
    const first = store.observe(pane, detectPendingRequest(permissionScreen), 1000)!;
    const repeated = store.observe(pane, detectPendingRequest(permissionScreen), 2000)!;
    expect(repeated.id).toBe(first.id);
    expect(repeated.createdAt).toBe(first.createdAt);
    const replacement = store.observe(pane, detectPendingRequest(permissionScreen.replace("mkfifo", "mkdir")), 3000)!;
    expect(replacement.id).not.toBe(first.id);
    expect(store.listPending(3000).map((request) => request.id)).toEqual([replacement.id]);
  });

  test("request generation survives preview pointer movement but not daemon restart", () => {
    const firstStore = new PendingRequestStore();
    const first = firstStore.observe(pane, detectPendingRequest(previewScreen), 1000)!;
    const movedScreen = previewScreen.replace("❯ 1. Boxy", "  1. Boxy").replace("  2. Rounded", "❯ 2. Rounded").replace("rounded mockup", "different mockup");
    const moved = firstStore.observe(pane, detectPendingRequest(movedScreen), 2000)!;
    expect(moved.id).toBe(first.id);
    expect(firstStore.find(first.id)?.signature).toBe(detectPendingRequest(movedScreen)?.signature);
    if (moved.kind === "preview-select") expect(moved.payload.preview.join(" ")).toContain("different mockup");

    const restarted = new PendingRequestStore().observe(pane, detectPendingRequest(previewScreen), 1000)!;
    expect(restarted.id).not.toBe(first.id);
  });

  test("truncated pane screens expire actionable state rather than guess the operation body", async () => {
    const cfg = daemonConfigFromEnv({});
    const store = new PendingRequestStore();
    const request = store.observe(pane, detectPendingRequest(permissionScreen), 1000)!;
    const fetcher: BridgeFetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/api/snapshot")) return Response.json({
        bridge: "connected", agents: [pane], shellPanes: [], workspaces: [], tabs: [], sessions: [], ts: 2,
      });
      return Response.json({ text: permissionScreen, truncated: true });
    };
    expect(await collectPendingRequests(cfg, fetcher, store, null, 2000)).toEqual([]);
    expect(store.find(request.id)?.request.status).toBe("expired");
  });

  test("an older overlapping collection cannot reconcile away a newer pending request", async () => {
    const cfg = daemonConfigFromEnv({});
    const store = new PendingRequestStore();
    const blockedSnapshot = {
      bridge: "connected", agents: [pane], shellPanes: [], workspaces: [], tabs: [], sessions: [], ts: 1,
    };
    const emptySnapshot = { ...blockedSnapshot, agents: [], ts: 0 };
    let releaseFirst!: (response: Response) => void;
    const firstSnapshot = new Promise<Response>((resolve) => { releaseFirst = resolve; });
    let snapshots = 0;
    const fetcher: BridgeFetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/api/snapshot")) {
        snapshots++;
        return snapshots === 1 ? firstSnapshot : Response.json(blockedSnapshot);
      }
      if (url.endsWith("/api/pane/w1:p2")) return Response.json({ text: permissionScreen });
      throw new Error(`unexpected route ${url}`);
    };
    const first = collectPendingRequests(cfg, fetcher, store);
    await Promise.resolve();
    const second = await collectPendingRequests(cfg, fetcher, store);
    expect(second).toHaveLength(1);
    releaseFirst(Response.json(emptySnapshot));
    await first;
    expect(store.listPending()).toHaveLength(1);
  });

  test("settled requests release their active pane pointer without reappearing unchanged", () => {
    const store = new PendingRequestStore();
    const first = store.observe(pane, detectPendingRequest(permissionScreen), 1000)!;
    store.settle(first.id, "resolved");
    expect(store.find(first.id)?.request.status).toBe("resolved");
    expect(store.observe(pane, detectPendingRequest(permissionScreen), 2000)).toBeNull();
    const next = store.observe(pane, detectPendingRequest(permissionScreen.replace("mkfifo", "mkdir")), 3000)!;
    expect(next.id).not.toBe(first.id);
  });

  test("expires old requests and marks a vanished prompt resolved", () => {
    const store = new PendingRequestStore();
    const expired = store.observe(pane, detectPendingRequest(permissionScreen), 1000)!;
    expect(store.listPending(302_000)).toEqual([]);
    expect(store.find(expired.id)?.request.status).toBe("expired");
    store.reconcileBlockedPanes(new Set());

    const resolved = store.observe(pane, detectPendingRequest(permissionScreen), 400_000)!;
    expect(store.observe(pane, null, 401_000)).toBeNull();
    expect(store.find(resolved.id)?.request.status).toBe("resolved");
  });

  test("revalidates prompt binding, forwards only the selected choice, and treats repeats idempotently", async () => {
    const cfg = daemonConfigFromEnv({});
    const store = new PendingRequestStore();
    const request = store.observe(pane, detectPendingRequest(permissionScreen), 1000)!;
    const writes: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher: BridgeFetch = async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") {
        writes.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return Response.json({ ok: true });
      }
      return Response.json({ paneId: pane.paneId, text: permissionScreen, revision: 7 });
    };

    const result = await approvePendingRequest(cfg, fetcher, store, request.id, "2", 2000);
    const duplicate = await approvePendingRequest(cfg, fetcher, store, request.id, "2", 2001);
    expect(result).toEqual({ status: "resolved", outcome: "submitted" });
    expect(duplicate.outcome).toBe("already-handled");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.url).toContain("/api/pane/w1:p2/keys");
    expect(writes[0]?.body).toMatchObject({ keys: ["2"], expected_prompt: request ? detectPendingRequest(permissionScreen)?.signature : "" });
  });

  test("preview approvals move, verify the pointer, then commit with a fresh binding", async () => {
    const cfg = daemonConfigFromEnv({});
    const store = new PendingRequestStore();
    const request = store.observe(pane, detectPendingRequest(previewScreen), 1000)!;
    let screen = previewScreen;
    const writes: Array<Record<string, unknown>> = [];
    const events: string[] = [];
    const fetcher: BridgeFetch = async (_input, init) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        writes.push(body);
        const keys = body.keys as string[];
        events.push(keys[0] === "Enter" ? "enter" : "digit");
        if (JSON.stringify(body.keys) === '["2"]') {
          screen = screen.replace("❯ 1. Boxy", "  1. Boxy").replace("  2. Rounded", "❯ 2. Rounded");
          store.observe(pane, detectPendingRequest(screen), 2500);
        }
        return Response.json({ ok: true });
      }
      events.push("poll");
      return Response.json({ text: screen });
    };

    const result = await approvePendingRequest(cfg, fetcher, store, request.id, "2", 2000, null, async (ms) => {
      events.push(`delay:${ms}`);
    });
    expect(result).toEqual({ status: "resolved", outcome: "submitted" });
    expect(writes.map((body) => body.keys)).toEqual([["2"], ["Enter"]]);
    expect(events).toEqual(["poll", "digit", "delay:350", "poll", "enter"]);
    expect(writes[1]?.expected_prompt).toBe(detectPendingRequest(screen)?.signature);
  });

  test("preview midflight replacement with the same option number never receives Enter", async () => {
    const cfg = daemonConfigFromEnv({});
    const store = new PendingRequestStore();
    const request = store.observe(pane, detectPendingRequest(previewScreen), 1000)!;
    let screen = previewScreen;
    const writes: string[][] = [];
    const fetcher: BridgeFetch = async (_input, init) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { keys: string[] };
        writes.push(body.keys);
        screen = screen.replace("Which widget design should we use?", "Which replacement should we use?")
          .replace("❯ 1. Boxy", "  1. Boxy").replace("  2. Rounded", "❯ 2. Rounded");
        return Response.json({ ok: true });
      }
      return Response.json({ text: screen });
    };
    const result = await approvePendingRequest(cfg, fetcher, store, request.id, "2", 2000, null, async () => {});
    expect(result).toEqual({ status: "expired", outcome: "stale" });
    expect(writes).toEqual([["2"]]);
  });

  test("changed prompt expires the request without forwarding keys", async () => {
    const cfg = daemonConfigFromEnv({});
    const store = new PendingRequestStore();
    const request = store.observe(pane, detectPendingRequest(permissionScreen), 1000)!;
    let writes = 0;
    const fetcher: BridgeFetch = async () => { writes++; return Response.json({ text: permissionScreen.replace("mkfifo", "mkdir") }); };
    const result = await approvePendingRequest(cfg, fetcher, store, request.id, "1", 2000);
    expect(result.status).toBe("expired");
    expect(writes).toBe(1);
  });

  test("a failed preflight read remains pending and can be retried safely", async () => {
    const cfg = daemonConfigFromEnv({});
    const store = new PendingRequestStore();
    const request = store.observe(pane, detectPendingRequest(permissionScreen), 1000)!;
    let disconnected = true;
    let writes = 0;
    const fetcher: BridgeFetch = async (_input, init) => {
      if (init?.method === "POST") {
        writes++;
        return Response.json({ ok: true });
      }
      if (disconnected) throw new Error("bridge unreachable");
      return Response.json({ text: permissionScreen });
    };
    const unavailable = await approvePendingRequest(cfg, fetcher, store, request.id, "1", 2000);
    expect(unavailable).toEqual({ status: "pending", outcome: "not-submitted" });
    expect(store.find(request.id)?.request.status).toBe("pending");
    expect(writes).toBe(0);

    disconnected = false;
    const retried = await approvePendingRequest(cfg, fetcher, store, request.id, "1", 3000);
    expect(retried).toEqual({ status: "resolved", outcome: "submitted" });
    expect(writes).toBe(1);
  });

  test("a concurrent truncated collection cannot expire a claimed request before read_failed retry", async () => {
    const cfg = daemonConfigFromEnv({});
    const store = new PendingRequestStore();
    const request = store.observe(pane, detectPendingRequest(permissionScreen), 1000)!;
    let resolveFirstWrite!: (response: Response) => void;
    let markWriteStarted!: () => void;
    const firstWrite = new Promise<Response>((resolve) => { resolveFirstWrite = resolve; });
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
    let writes = 0;
    let paneTruncated = false;
    const fetcher: BridgeFetch = async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") {
        writes++;
        if (writes === 1) {
          markWriteStarted();
          return firstWrite;
        }
        return Response.json({ ok: true });
      }
      if (url.endsWith("/api/snapshot")) return Response.json({
        bridge: "connected", agents: [pane], shellPanes: [], workspaces: [], tabs: [], sessions: [], ts: Date.now(),
      });
      return Response.json({ text: permissionScreen, truncated: paneTruncated });
    };

    const firstApproval = approvePendingRequest(cfg, fetcher, store, request.id, "1", 2000);
    await writeStarted;
    paneTruncated = true;
    const concurrentPoll = await collectPendingRequests(cfg, fetcher, store, null, 2500);
    expect(concurrentPoll.map((item) => item.id)).toEqual([request.id]);
    expect(store.find(request.id)?.request.status).toBe("pending");

    resolveFirstWrite(Response.json({ ok: false, code: "prompt.read_failed" }, { status: 502 }));
    expect(await firstApproval).toEqual({ status: "pending", outcome: "not-submitted" });
    paneTruncated = false;
    expect((await collectPendingRequests(cfg, fetcher, store, null, 3000)).map((item) => item.id)).toEqual([request.id]);
    expect(await approvePendingRequest(cfg, fetcher, store, request.id, "1", 4000)).toEqual({
      status: "resolved", outcome: "submitted",
    });
    expect(writes).toBe(2);
  });

  test("prompt.read_failed preserves pending state through collection and retries after recovery", async () => {
    const cfg = daemonConfigFromEnv({});
    const store = new PendingRequestStore();
    const request = store.observe(pane, detectPendingRequest(permissionScreen), 1000)!;
    let failBeforeWrite = true;
    let writes = 0;
    const fetcher: BridgeFetch = async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") {
        writes++;
        if (failBeforeWrite) return Response.json({ ok: false, code: "prompt.read_failed" }, { status: 502 });
        return Response.json({ ok: true });
      }
      if (url.endsWith("/api/snapshot")) return Response.json({
        bridge: "connected", agents: [pane], shellPanes: [], workspaces: [], tabs: [], sessions: [], ts: Date.now(),
      });
      return Response.json({ text: permissionScreen });
    };

    const refused = await approvePendingRequest(cfg, fetcher, store, request.id, "1", 2000);
    expect(refused).toEqual({ status: "pending", outcome: "not-submitted" });
    expect(store.find(request.id)?.request.status).toBe("pending");
    const afterCollection = await collectPendingRequests(cfg, fetcher, store, null, 3000);
    expect(afterCollection.map((item) => item.id)).toEqual([request.id]);

    failBeforeWrite = false;
    const retried = await approvePendingRequest(cfg, fetcher, store, request.id, "1", 4000);
    expect(retried).toEqual({ status: "resolved", outcome: "submitted" });
    expect(writes).toBe(2);
  });

  test("an upstream prompt-binding race refusal expires without retry", async () => {
    const cfg = daemonConfigFromEnv({});
    const store = new PendingRequestStore();
    const request = store.observe(pane, detectPendingRequest(permissionScreen), 1000)!;
    let writes = 0;
    const fetcher: BridgeFetch = async (_input, init) => {
      if (init?.method === "POST") {
        writes++;
        return new Response("changed", { status: 409 });
      }
      return Response.json({ text: permissionScreen });
    };
    const result = await approvePendingRequest(cfg, fetcher, store, request.id, "1", 2000);
    expect(result).toEqual({ status: "expired", outcome: "stale" });
    expect(writes).toBe(1);
    expect(store.find(request.id)?.request.status).toBe("expired");
  });
});
