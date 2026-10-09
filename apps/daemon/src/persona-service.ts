import { dirname, join } from "node:path";
import { safeErrorCode, safeUpstreamFailure } from "./safe-error.ts";
import { PersonaMemoryStore } from "./persona-memory.ts";
import { memoryInjectionPlan } from "./memory-injection.ts";
import { prepareMemorySession, memoryMessageText, injectedMessagePresentation } from "./session-memory.ts";
import { SessionLocked, lockedResponse, type MutationAdmission } from "./session-lock.ts";
import type { SystemAdmission } from "./system-admission.ts";
import type { BridgeFetch } from "./bridge-proxy.ts";
import type { ActivityLedger } from "./activity-ledger.ts";
import { dispatchTaskCreation } from "./mutation-result.ts";
import type { DaemonConfig } from "./config.ts";
import { controlKeyBlocksText } from "./control-key.ts";
import { HerdrRpcError, type HerdrCreatedSpace, type HerdrPane, type HerdrPort, type HerdrSnapshot } from "./herdr-client.ts";
import { awaitAgentReady, awaitPaneReady } from "./persona-readiness.ts";
import { newPersonaId, PersonaRegistry, type Persona, type PersonaAvatar } from "./persona-registry.ts";

export interface PersonaRuntime {
  readonly registry: PersonaRegistry;
  readonly activity?: ActivityLedger;
  observeTask?: (paneId: string) => Promise<void>;
  readonly herdr: HerdrPort;
  readonly cfg: DaemonConfig;
  readonly fetcher: BridgeFetch;
  readonly memory?: PersonaMemoryStore;
}

const memoryStores = new WeakMap<PersonaRuntime, PersonaMemoryStore>();
export function memoryStoreOf(runtime: PersonaRuntime): PersonaMemoryStore {
  if (runtime.memory) return runtime.memory;
  let store = memoryStores.get(runtime);
  if (!store) {
    store = new PersonaMemoryStore(runtime.cfg.memoryPath ?? join(dirname(runtime.cfg.registryPath), "memory"));
    memoryStores.set(runtime, store);
  }
  return store;
}

const personaOperationTails = new WeakMap<PersonaRuntime, Map<string, Promise<void>>>();
function withPersonaLock<T>(runtime: PersonaRuntime, id: string, operation: () => Promise<T>): Promise<T> {
  let tails = personaOperationTails.get(runtime);
  if (!tails) {
    tails = new Map();
    personaOperationTails.set(runtime, tails);
  }
  const previous = tails.get(id) ?? Promise.resolve();
  const current = previous.then(operation);
  const tail = current.then(() => undefined, () => undefined);
  tails.set(id, tail);
  void tail.then(() => { if (tails?.get(id) === tail) tails.delete(id); });
  return current;
}

interface Launcher {
  readonly command: string;
  readonly label: string;
  readonly cwd?: string;
}

interface LauncherList {
  readonly launchers: readonly Launcher[];
  readonly home: string;
}

function safeId(id: string): boolean {
  return /^[A-Za-z0-9._~-]{1,128}$/.test(id);
}

function statusOf(persona: Persona, snapshot: HerdrSnapshot): Pick<import("@homeling/contracts").PersonaView, "status" | "statusSource"> {
  if (!snapshot.panes.some((pane) => pane.pane_id === persona.mainPaneId)) return { status: "idle", statusSource: "missing" };
  const status = snapshot.agents.find((item) => item.pane_id === persona.mainPaneId)?.agent_status;
  switch (status) {
    case "blocked": return { status: persona.paused ? "idle" : "blocked", statusSource: "agent" };
    case "working": return { status: persona.paused ? "idle" : "thinking", statusSource: "agent" };
    case "idle":
    case "done": return { status: "idle", statusSource: "agent" };
    default: return { status: persona.paused ? "idle" : "active", statusSource: "pane" };
  }
}

export async function getLaunchers(cfg: DaemonConfig, fetcher: BridgeFetch, login?: string | null): Promise<LauncherList> {
  const headers = new Headers({ accept: "application/json" });
  const effectiveLogin = login ?? cfg.trustedUsers[0];
  if (effectiveLogin) headers.set("tailscale-user-login", effectiveLogin);
  const response = await fetcher(`${cfg.bridgeOrigin}/api/launchers`, { method: "GET", headers });
  if (!response.ok) throw new Error(`Launcher allowlist unavailable (${response.status})`);
  const body = await response.json() as Partial<LauncherList>;
  if (!Array.isArray(body.launchers) || typeof body.home !== "string") throw new Error("Invalid launcher allowlist response");
  const launchers = body.launchers.filter((row): row is Launcher =>
    !!row && typeof row.command === "string" && row.command.length > 0 && typeof row.label === "string",
  );
  return { launchers, home: body.home };
}

async function startLauncher(runtime: PersonaRuntime, launcher: Launcher, paneId: string, admission: MutationAdmission): Promise<void> {
  const ready = await awaitPaneReady(runtime.herdr, paneId);
  if (!ready.ready) throw new HerdrRpcError("herdr.pane_not_ready", `Shell pane ${paneId} was not ready after ${ready.ms}ms`);
  await admission.dispatch(() => runtime.herdr.sendText(paneId, launcher.command));
  await admission.dispatch(() => runtime.herdr.sendKeys(paneId, ["Enter"]));
  await awaitAgentReady(runtime.herdr, paneId);
}

export async function createPersona(
  runtime: PersonaRuntime,
  input: { name: string; avatar: PersonaAvatar; systemPrompt?: string; launcherCommand?: string },
  login: string | null,
  admission: MutationAdmission,
): Promise<Persona> {
  admission.assert();
  const launchers = await getLaunchers(runtime.cfg, runtime.fetcher, login);
  const launcher = launchers.launchers.find((row) => row.command === input.launcherCommand) ??
    (input.launcherCommand ? undefined : launchers.launchers[0]);
  if (!launcher) throw new Error(input.launcherCommand ? "Launcher is not allowlisted" : "No launchers are allowlisted");
  const id = newPersonaId();
  let memorySession: Persona["memorySession"];
  let space: HerdrCreatedSpace;
  try {
    space = await admission.dispatch(() => runtime.herdr.createSpace(input.name, launcher.cwd ?? launchers.home));
  } catch (error) {
    if (error instanceof HerdrRpcError && ["herdr.timeout", "herdr.unavailable", "herdr.protocol"].includes(error.code)) {
      await runtime.registry.addOrphan({
        spaceId: "unknown",
        createdAt: new Date().toISOString(),
        reason: `workspace.create outcome unknown: ${safeErrorCode(error, "persona.create_failed")}`,
      });
    }
    throw error;
  }
  try {
    const prepared = await prepareMemorySession(memoryStoreOf(runtime), id, space.root_pane.pane_id, launcher.command, input.systemPrompt ?? "", admission);
    memorySession = prepared.session;
    await startLauncher(runtime, { ...launcher, command: prepared.command }, space.root_pane.pane_id, admission);
  } catch (error) {
    let rollbackError = "";
    try {
      await runtime.herdr.closePane(space.root_pane.pane_id);
    } catch (rollback) {
      rollbackError = `; pane rollback failed: ${safeErrorCode(rollback, "pane.rollback_failed")}`;
    }
    // Herdr exposes no workspace.close RPC; persist the empty/partial space as an orphan for later cleanup.
    await runtime.registry.addOrphan({
      spaceId: space.workspace_id,
      paneId: rollbackError ? space.root_pane.pane_id : undefined,
      createdAt: new Date().toISOString(),
      reason: `persona create failed: ${safeErrorCode(error, "persona.create_failed")}${rollbackError}`,
    });
    const message = `Could not start persona pane; created space is marked for cleanup${rollbackError}`;
    if (error instanceof SessionLocked) throw error;
    throw error instanceof HerdrRpcError ? new HerdrRpcError(error.code, message) : new Error(message);
  }

  const persona: Persona = {
    id,
    name: input.name,
    avatar: input.avatar,
    spaceId: space.workspace_id,
    mainPaneId: space.root_pane.pane_id,
    systemPrompt: input.systemPrompt ?? "",
    createdAt: new Date().toISOString(),
    launcherCommand: launcher.command,
    memorySession,
    systemPromptInjected: memorySession?.strategy === "pi-append-system-prompt",
  };
  try {
    await runtime.registry.createPersona(persona, admission);
  } catch (error) {
    let paneStillOpen = false;
    try {
      await runtime.herdr.closePane(space.root_pane.pane_id);
    } catch {
      paneStillOpen = true;
    }
    await runtime.registry.addOrphan({
      spaceId: space.workspace_id,
      ...(paneStillOpen ? { paneId: space.root_pane.pane_id } : {}),
      createdAt: new Date().toISOString(),
      reason: `registry commit failed: ${safeErrorCode(error, "operation.failed")}`,
    });
    throw error;
  }
  return persona;
}

export async function listPersonas(runtime: PersonaRuntime): Promise<readonly (Persona & { status: string })[]> {
  const [personas, snapshot] = await Promise.all([runtime.registry.list(), runtime.herdr.snapshot()]);
  return personas.map((persona) => ({ ...persona, ...statusOf(persona, snapshot) }));
}

export function updatePersona(
  runtime: PersonaRuntime,
  id: string,
  patch: { name?: string; avatar?: PersonaAvatar; systemPrompt?: string; paused?: boolean },
  admission: MutationAdmission,
): Promise<Persona | undefined> {
  return withPersonaLock(runtime, id, async () => {
    admission.assert();
    const current = await runtime.registry.get(id);
    if (!current) return undefined;
    const renamed = patch.name !== undefined && patch.name !== current.name;
    if (renamed) await admission.dispatch(() => runtime.herdr.renameSpace(current.spaceId, patch.name!));
    try {
      const updated = await runtime.registry.patchPersona(id, patch, admission);
      if (!updated && renamed) await runtime.herdr.renameSpace(current.spaceId, current.name);
      return updated;
    } catch (error) {
      if (renamed) {
        try { await runtime.herdr.renameSpace(current.spaceId, current.name); }
        catch (rollback) {
          console.error(`[homeling-daemon] failed to restore space name after registry update failure: ${safeErrorCode(rollback, "operation.rollback_failed")}`);
        }
      }
      throw error;
    }
  });
}

export function deletePersona(runtime: PersonaRuntime, id: string, admission: MutationAdmission): Promise<{ deleted: boolean; archived: boolean }> {
  return withPersonaLock(runtime, id, async () => {
    admission.assert();
    let suppressed = suppressedRecoveryIds.get(runtime);
    if (!suppressed) {
      suppressed = new Set();
      suppressedRecoveryIds.set(runtime, suppressed);
    }
    suppressed.add(id);
    try {
      const persona = await runtime.registry.get(id);
      if (!persona) return { deleted: false, archived: false };
      try {
        await admission.dispatch(() => runtime.herdr.closePane(persona.mainPaneId));
      } catch (error) {
        if (!(error instanceof HerdrRpcError) || error.code !== "pane_not_found") throw error;
      }
      const archivedAt = new Date().toISOString();
      let archived = true;
      try {
        await admission.dispatch(() => runtime.herdr.renameSpace(persona.spaceId, `[Archived] ${persona.name}`));
      } catch (error) {
        archived = false;
        console.error(`[homeling-daemon] persona deleted but space archive rename failed: ${safeErrorCode(error, "operation.failed")}`);
      }
      // Result settlement for this already-closed pane must persist its tombstone even if the
      // initiating lease expired, otherwise system recovery could resurrect the deleted persona.
      await runtime.registry.removePersona(id, { spaceId: persona.spaceId, personaName: persona.name, archivedAt });
      return { deleted: true, archived };
    } finally {
      suppressed.delete(id);
    }
  });
}

export function sendPersonaMessage(
  runtime: PersonaRuntime,
  id: string,
  text: string,
  login: string | null,
  admission: MutationAdmission,
): Promise<Response> {
  return withPersonaLock(runtime, id, async () => {
    admission.assert();
    const persona = await runtime.registry.get(id);
    if (!persona) return Response.json({ error: "persona not found" }, { status: 404 });
    if (persona.paused) return Response.json({ error: "persona paused" }, { status: 409 });
    const headers = new Headers({ accept: "application/json", "content-type": "application/json" });
    if (login) headers.set("tailscale-user-login", login);
    if (persona.memoryDeliveryUnknown) return Response.json({ ok: false, code: "memory.delivery_unknown", deliveryUnknown: true, error: "Previous message delivery is unknown or partial; inspect the pane before starting a new session. No automatic replay." }, { status: 409 });
    let session = persona.memorySession?.paneId === persona.mainPaneId ? persona.memorySession : undefined;
    if (!session) {
      // Existing panes cannot gain pi startup flags retroactively. Freeze only an as-yet-unsent first message.
      const plan = memoryInjectionPlan("", persona.systemPrompt, await memoryStoreOf(runtime).read(id));
      session = { paneId: persona.mainPaneId, strategy: "first-message-prefix", unsupported: true, notice: "unsupported native injection for this existing session; first-message prefix only, native pi memory applies next session.", prefix: persona.systemPromptInjected ? "" : plan.context };
      await runtime.registry.patchPersona(id, { memorySession: session }, admission);
    }
    const submittedText = memoryMessageText(session, !!persona.systemPromptInjected, text);
    if (submittedText.length > 100_000) return Response.json({ ok: false, error: "Message plus memory exceeds 100,000 characters; shorten the message or memory", textDelivered: false, deliveryUnknown: false }, { status: 413 });
    const personaMessagePresentation = injectedMessagePresentation(id, persona.mainPaneId, text, submittedText);
    const memoryInjection = { strategy: session.strategy, unsupported: session.unsupported, notice: session.notice };
    let response: Response;
    let dispatched = false;
    try {
      if (controlKeyBlocksText(runtime.cfg, persona.mainPaneId)) {
        return Response.json({ ok: false, textDelivered: false, error: "Cancellation is in flight or unknown; inspect the terminal before sending text" }, { status: 409 });
      }
      // Durable intent prevents a daemon crash or lost reply from replaying a first-message injection.
      await runtime.registry.patchPersona(id, { memoryDeliveryUnknown: true }, admission);
      response = await admission.dispatch(() => {
        dispatched = true;
        return runtime.fetcher(
          `${runtime.cfg.bridgeOrigin}/api/pane/${encodeURIComponent(persona.mainPaneId)}/reply`,
          { method: "POST", headers, body: JSON.stringify({ text: submittedText, submit: true }) },
        );
      });
    } catch (error) {
      if (!dispatched) {
        // Limited result settlement for this provably-undispatched attempt, not a new user mutation.
        await runtime.registry.patchPersona(id, { memoryDeliveryUnknown: false });
        if (error instanceof SessionLocked) return lockedResponse();
        throw error;
      }
      return Response.json({
        ok: false, deliveryUnknown: true, personaConfirmationText: submittedText, personaMessagePresentation, memoryInjection,
        error: "Message delivery outcome unknown",
      }, { status: 502 });
    }
    const outcome = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
    const accepted = response.ok && outcome?.ok === true;
    const textDelivered = outcome?.textDelivered === true;
    const partial = !accepted && (textDelivered || outcome?.deliveryUnknown === true || response.status >= 500 || !outcome || outcome.ok !== false);
    try {
      // Only settle this already-dispatched attempt; never use a system actor for delegated user work.
      await runtime.registry.patchPersona(id, { memoryDeliveryUnknown: partial, ...((accepted || textDelivered) ? { systemPromptInjected: true } : {}) });
    } catch {
      return Response.json({ ok: false, deliveryUnknown: true, personaConfirmationText: submittedText, personaMessagePresentation, memoryInjection, error: "Message was dispatched but its injection outcome could not be persisted; reconcile before retrying" }, { status: 503 });
    }
    return Response.json({
      ...(accepted ? { ok: true, ...(textDelivered ? { textDelivered: true } : {}) } : safeUpstreamFailure(outcome, "Message delivery failed", "reply.failed", partial)),
      ...(partial && !textDelivered ? { deliveryUnknown: true } : {}),
      personaConfirmationText: submittedText, personaMessagePresentation, memoryInjection,
    }, { status: response.status });
  });
}

export function launchPersonaTask(
  runtime: PersonaRuntime,
  personaId: string,
  command: string,
  login: string | null,
  admission: MutationAdmission,
): Promise<Response> {
  return withPersonaLock(runtime, personaId, async () => {
    admission.assert();
    const persona = await runtime.registry.get(personaId);
  if (!persona) return Response.json({ ok: false, error: "persona not found", code: "persona.not_found" }, { status: 404 });
  if (persona.paused) return Response.json({ ok: false, error: "persona paused", code: "persona.paused" }, { status: 409 });
  if (!safeId(personaId)) return Response.json({ ok: false, error: "invalid persona id", code: "persona.invalid_id" }, { status: 400 });
  let launchers: LauncherList;
  try {
    launchers = await getLaunchers(runtime.cfg, runtime.fetcher, login);
  } catch (error) {
    return Response.json({ ok: false, error: "Launcher allowlist unavailable", code: "launch.allowlist_unavailable" }, { status: 502 });
  }
  const launcher = launchers.launchers.find((row) => row.command === command);
  if (!launcher) return Response.json({ ok: false, error: "Launcher is not allowlisted", code: "launch.not_allowlisted" }, { status: 400 });
  let tabPane: HerdrPane | undefined;
  let occurrenceKey: string | undefined;
  try {
    tabPane = await dispatchTaskCreation(admission, () => runtime.herdr.createTab(persona.spaceId, launcher.cwd), async (pane, result) => {
      tabPane = pane;
      if (pane.workspace_id !== persona.spaceId) throw new HerdrRpcError("herdr.protocol", "Created task pane does not belong to the requested persona space");
      if (runtime.activity) {
        const occurrence = await runtime.activity.register({ personaId, spaceId: pane.workspace_id, paneId: pane.pane_id, title: launcher.label || launcher.command }, result);
        occurrenceKey = occurrence.occurrenceKey;
      }
    });
    if (runtime.activity) {
      if (!runtime.observeTask) throw new Error("Activity observer is unavailable; task was not started");
      await runtime.observeTask(tabPane.pane_id);
    }
    await startLauncher(runtime, launcher, tabPane.pane_id, admission);
  } catch (error) {
    const unknown = error instanceof SessionLocked || error instanceof HerdrRpcError && ["herdr.timeout", "herdr.unavailable", "herdr.protocol", "herdr.agent_start_timeout"].includes(error.code);
    if (occurrenceKey && !unknown) {
      try { await runtime.activity!.fail(occurrenceKey, `Task launch failed: ${safeErrorCode(error, "operation.failed")}`, admission); }
      catch (registrationError) { console.error("[homeling-daemon] could not register task launch failure", safeErrorCode(registrationError, "activity.persistence_failed")); }
    }
    let paneStillOpen = false;
    if (tabPane) {
      try { await runtime.herdr.closePane(tabPane.pane_id); }
      catch { paneStillOpen = true; }
    }
    await runtime.registry.addOrphan({
      spaceId: persona.spaceId,
      ...(tabPane && paneStillOpen ? { paneId: tabPane.pane_id } : {}),
      createdAt: new Date().toISOString(),
      reason: `task launch failed: ${safeErrorCode(error, "operation.failed")}`,
    });
    if (error instanceof SessionLocked) throw error;
    return Response.json({ ok: false, error: "Task launch failed", code: safeErrorCode(error, "launch.failed"), ...(unknown ? { deliveryUnknown: true } : {}) }, { status: 502 });
  }
  const snapshot = await runtime.herdr.snapshot().catch(() => null);
  const workspaceLabel = snapshot?.workspaces.find((space) => space.workspace_id === persona.spaceId)?.label ?? persona.name;
  return Response.json({ ok: true, pane: {
    paneId: tabPane.pane_id,
    workspaceId: persona.spaceId,
    workspaceLabel,
    tabId: tabPane.tab_id,
    cwd: tabPane.cwd,
  } });
  });
}

const recoveryRuns = new WeakMap<PersonaRuntime, Promise<void>>();
const suppressedRecoveryIds = new WeakMap<PersonaRuntime, Set<string>>();

export function recoverPersonas(runtime: PersonaRuntime, admission: SystemAdmission<"persona.recovery">): Promise<void> {
  const running = recoveryRuns.get(runtime);
  if (running) return running;
  const current = performRecovery(runtime, admission);
  recoveryRuns.set(runtime, current);
  void current.then(
    () => { if (recoveryRuns.get(runtime) === current) recoveryRuns.delete(runtime); },
    () => { if (recoveryRuns.get(runtime) === current) recoveryRuns.delete(runtime); },
  );
  return current;
}

async function recoverPersona(runtime: PersonaRuntime, id: string, admission: SystemAdmission<"persona.recovery">): Promise<void> {
  await withPersonaLock(runtime, id, async () => {
    if (suppressedRecoveryIds.get(runtime)?.has(id)) return;
    const persona = await runtime.registry.get(id);
    if (!persona) return;
    const snapshot = await runtime.herdr.snapshot();
    if (snapshot.panes.some((pane) => pane.pane_id === persona.mainPaneId)) {
      if (persona.needsAttention) await runtime.registry.patchPersona(id, { needsAttention: undefined }, admission);
      return;
    }
    if (!snapshot.workspaces.some((workspace) => workspace.workspace_id === persona.spaceId)) {
      await runtime.registry.patchPersona(id, { needsAttention: "space_missing" }, admission);
      return;
    }

    let launchers: LauncherList;
    try { launchers = await getLaunchers(runtime.cfg, runtime.fetcher); }
    catch (error) {
      console.error(`[homeling-daemon] recovery launcher allowlist unavailable: ${safeErrorCode(error, "operation.failed")}`);
      return;
    }
    const launcher = launchers.launchers.find((item) => item.command === persona.launcherCommand);
    if (!launcher) {
      await runtime.registry.patchPersona(id, { needsAttention: "launcher_not_allowlisted" }, admission);
      return;
    }

    let recoveredPane: HerdrPane | undefined;
    try {
      recoveredPane = await admission.dispatch(() => runtime.herdr.createTab(persona.spaceId, launcher.cwd));
      const prepared = await prepareMemorySession(memoryStoreOf(runtime), id, recoveredPane.pane_id, launcher.command, persona.systemPrompt, admission);
      await startLauncher(runtime, { ...launcher, command: prepared.command }, recoveredPane.pane_id, admission);
      const updated = await runtime.registry.patchPersona(id, {
        mainPaneId: recoveredPane.pane_id,
        launcherCommand: launcher.command,
        systemPromptInjected: prepared.session.strategy === "pi-append-system-prompt",
        memorySession: prepared.session,
        memoryDeliveryUnknown: false,
        needsAttention: undefined,
      }, admission);
      if (!updated) throw new Error("persona was deleted during recovery");
    } catch (error) {
      let paneStillOpen = false;
      if (recoveredPane) {
        try { await runtime.herdr.closePane(recoveredPane.pane_id); }
        catch { paneStillOpen = true; }
      }
      await runtime.registry.addOrphan({
        spaceId: persona.spaceId,
        ...(recoveredPane && paneStillOpen ? { paneId: recoveredPane.pane_id } : {}),
        createdAt: new Date().toISOString(),
        reason: `main pane recovery failed: ${safeErrorCode(error, "operation.failed")}`,
      });
    }
  });
}

async function performRecovery(runtime: PersonaRuntime, admission: SystemAdmission<"persona.recovery">): Promise<void> {
  const snapshot = await runtime.herdr.snapshot();
  const registry = await runtime.registry.load();
  for (const archived of registry.archivedSpaces) {
    const workspace = snapshot.workspaces.find((item) => item.workspace_id === archived.spaceId);
    if (!workspace || workspace.label.startsWith("[Archived]")) continue;
    try { await admission.dispatch(() => runtime.herdr.renameSpace(archived.spaceId, `[Archived] ${archived.personaName}`)); }
    catch (error) { console.error(`[homeling-daemon] could not mark archived space ${archived.spaceId}: ${safeErrorCode(error, "operation.failed")}`); }
  }
  for (const persona of await runtime.registry.list()) await recoverPersona(runtime, persona.id, admission);
}

export function createEventObserver(runtime: PersonaRuntime, admission: SystemAdmission<"persona.recovery">): { close(): void } {
  let closed = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let stream: { close(): void } | undefined;
  const reconcile = () => {
    void recoverPersonas(runtime, admission).catch((error: unknown) => {
      console.error(`[homeling-daemon] persona reconciliation failed: ${safeErrorCode(error, "operation.failed")}`);
    });
  };
  const reconcileTimer = setInterval(reconcile, 30_000);
  const connect = () => {
    if (closed) return;
    stream = runtime.herdr.subscribe(() => {
      // Events only poke a refresh/reconciliation; snapshots remain the source of truth.
      reconcile();
    }, () => {
      stream?.close();
      if (!closed) retryTimer = setTimeout(connect, 2_000);
    });
  };
  connect();
  return { close() { closed = true; clearTimeout(retryTimer); clearInterval(reconcileTimer); stream?.close(); } };
}

function validAvatarFields(avatar: Record<string, unknown>): boolean {
  return ["character", "pet"].every((key) => avatar[key] === undefined || (typeof avatar[key] === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(avatar[key])));
}

export function validatePersonaInput(value: unknown): { name: string; avatar: PersonaAvatar; systemPrompt?: string; launcherCommand?: string } | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80) return null;
  const rawAvatar = body.avatar && typeof body.avatar === "object" ? body.avatar as Record<string, unknown> : {};
  if (typeof rawAvatar.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(rawAvatar.color) || !validAvatarFields(rawAvatar)) return null;
  if (body.systemPrompt !== undefined && (typeof body.systemPrompt !== "string" || body.systemPrompt.length > 20_000)) return null;
  if (body.launcherCommand !== undefined && (typeof body.launcherCommand !== "string" || body.launcherCommand.length > 2_000)) return null;
  return {
    name: body.name.trim(),
    avatar: { color: rawAvatar.color, ...(typeof rawAvatar.character === "string" ? { character: rawAvatar.character } : {}), ...(typeof rawAvatar.pet === "string" ? { pet: rawAvatar.pet } : {}) },
    ...(typeof body.systemPrompt === "string" ? { systemPrompt: body.systemPrompt } : {}),
    ...(typeof body.launcherCommand === "string" ? { launcherCommand: body.launcherCommand } : {}),
  };
}

export function validatePersonaPatch(value: unknown): { name?: string; avatar?: PersonaAvatar; systemPrompt?: string; paused?: boolean } | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const patch: { name?: string; avatar?: PersonaAvatar; systemPrompt?: string; paused?: boolean } = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80) return null;
    patch.name = body.name.trim();
  }
  if (body.avatar !== undefined) {
    const avatar = body.avatar as Record<string, unknown> | null;
    if (!avatar || typeof avatar.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(avatar.color) || !validAvatarFields(avatar)) return null;
    patch.avatar = { color: avatar.color, ...(typeof avatar.character === "string" ? { character: avatar.character } : {}), ...(typeof avatar.pet === "string" ? { pet: avatar.pet } : {}) };
  }
  if (body.systemPrompt !== undefined) {
    if (typeof body.systemPrompt !== "string" || body.systemPrompt.length > 20_000) return null;
    patch.systemPrompt = body.systemPrompt;
  }
  if (body.paused !== undefined) {
    if (typeof body.paused !== "boolean") return null;
    patch.paused = body.paused;
  }
  return Object.keys(patch).length ? patch : null;
}
