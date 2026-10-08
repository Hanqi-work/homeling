import { createConnection, type Socket } from "node:net";
import { StringDecoder } from "node:string_decoder";
import { randomUUID } from "node:crypto";

export class HerdrRpcError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "HerdrRpcError";
  }
}

export interface HerdrPane {
  readonly pane_id: string;
  readonly workspace_id: string;
  readonly tab_id: string;
  readonly cwd: string;
}

export interface HerdrCreatedSpace {
  readonly workspace_id: string;
  readonly label: string;
  readonly root_pane: HerdrPane;
}

export interface HerdrSnapshot {
  readonly workspaces: readonly { readonly workspace_id: string; readonly label: string }[];
  readonly tabs: readonly { readonly tab_id: string; readonly workspace_id: string }[];
  readonly panes: readonly HerdrPane[];
  readonly agents: readonly { readonly pane_id: string; readonly status?: string }[];
}

export interface HerdrClientOptions {
  readonly socketPath: string;
  readonly timeoutMs?: number;
}

export interface HerdrPort {
  createSpace(label: string, cwd: string): Promise<HerdrCreatedSpace>;
  createTab(workspaceId: string, cwd?: string): Promise<HerdrPane>;
  readPane(paneId: string, lines?: number): Promise<string>;
  sendText(paneId: string, text: string): Promise<void>;
  sendKeys(paneId: string, keys: readonly string[]): Promise<void>;
  closePane(paneId: string): Promise<void>;
  renameSpace(workspaceId: string, label: string): Promise<void>;
  snapshot(): Promise<HerdrSnapshot>;
  subscribe(onEvent: (event: string, data: unknown) => void, onDown: (reason: string) => void): { close(): void };
}

function connect(socketPath: string, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new HerdrRpcError("herdr.timeout", `Herdr socket connection timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(new HerdrRpcError("herdr.unavailable", `Herdr socket unavailable: ${error.message}`));
    });
  });
}

export class HerdrSocketClient implements HerdrPort {
  readonly socketPath: string;
  readonly timeoutMs: number;

  constructor(options: HerdrClientOptions) {
    this.socketPath = options.socketPath;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  private async rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const socket = await connect(this.socketPath, this.timeoutMs);
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      let buffer = "";
      const decoder = new StringDecoder("utf8");
      let settled = false;
      const finish = (error?: Error, result?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else resolve(result as T);
      };
      const timer = setTimeout(() => finish(new HerdrRpcError("herdr.timeout", `Herdr ${method} timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
      socket.on("data", (chunk: Buffer) => {
        buffer += decoder.write(chunk);
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        try {
          const response = JSON.parse(buffer.slice(0, newline)) as {
            id?: string;
            result?: T;
            error?: { code?: string; message?: string };
          };
          if (response.id !== id && response.id !== "") {
            finish(new HerdrRpcError("herdr.protocol", `Herdr ${method} returned a mismatched response id`));
          } else if (response.error) {
            finish(new HerdrRpcError(response.error.code ?? "herdr.rpc_error", response.error.message ?? `Herdr ${method} failed`));
          } else if (!response.result) {
            finish(new HerdrRpcError("herdr.protocol", `Herdr ${method} returned no result`));
          } else finish(undefined, response.result);
        } catch (error) {
          finish(new HerdrRpcError("herdr.protocol", `Invalid Herdr ${method} response: ${String(error)}`));
        }
      });
      socket.once("error", (error) => finish(new HerdrRpcError("herdr.unavailable", `Herdr ${method} failed: ${error.message}`)));
      socket.once("end", () => {
        if (!settled) finish(new HerdrRpcError("herdr.protocol", `Herdr closed before replying to ${method}`));
      });
      socket.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (error) finish(new HerdrRpcError("herdr.unavailable", `Could not send Herdr ${method}: ${error.message}`));
      });
    });
  }

  async createSpace(label: string, cwd: string): Promise<HerdrCreatedSpace> {
    const result = await this.rpc<{ workspace: { workspace_id: string; label: string }; root_pane: HerdrPane }>(
      "workspace.create", { cwd, focus: false, label },
    );
    return { workspace_id: result.workspace.workspace_id, label: result.workspace.label, root_pane: result.root_pane };
  }

  async createTab(workspaceId: string, cwd?: string): Promise<HerdrPane> {
    const params: Record<string, unknown> = { workspace_id: workspaceId, focus: false };
    if (cwd) params.cwd = cwd;
    const result = await this.rpc<{ root_pane: HerdrPane }>("tab.create", params);
    return result.root_pane;
  }

  async readPane(paneId: string, lines = 40): Promise<string> {
    const result = await this.rpc<{ read: { text: string } }>("pane.read", {
      pane_id: paneId, source: "visible", lines, format: "text",
    });
    return result.read.text;
  }

  async sendText(paneId: string, text: string): Promise<void> {
    await this.rpc("pane.send_text", { pane_id: paneId, text });
  }

  async sendKeys(paneId: string, keys: readonly string[]): Promise<void> {
    await this.rpc("pane.send_keys", { pane_id: paneId, keys });
  }

  async closePane(paneId: string): Promise<void> {
    await this.rpc("pane.close", { pane_id: paneId });
  }

  async renameSpace(workspaceId: string, label: string): Promise<void> {
    await this.rpc("workspace.rename", { workspace_id: workspaceId, label });
  }

  async snapshot(): Promise<HerdrSnapshot> {
    const result = await this.rpc<{ snapshot: HerdrSnapshot }>("session.snapshot");
    return result.snapshot;
  }

  subscribe(onEvent: (event: string, data: unknown) => void, onDown: (reason: string) => void): { close(): void } {
    let socket: Socket | undefined;
    let closed = false;
    let buffer = "";
    const decoder = new StringDecoder("utf8");
    const close = () => {
      closed = true;
      socket?.destroy();
    };
    void connect(this.socketPath, this.timeoutMs).then((connected) => {
      if (closed) return connected.destroy();
      socket = connected;
      socket.on("data", (chunk: Buffer) => {
        buffer += decoder.write(chunk);
        for (;;) {
          const newline = buffer.indexOf("\n");
          if (newline < 0) break;
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          try {
            const message = JSON.parse(line) as { event?: string; data?: unknown };
            if (message.event) onEvent(message.event, message.data);
          } catch {
            onDown("Invalid Herdr event frame");
            close();
          }
        }
      });
      socket.once("error", (error) => { if (!closed) onDown(`Herdr event stream failed: ${error.message}`); });
      socket.once("close", () => { if (!closed) onDown("Herdr event stream closed"); });
      socket.write(`${JSON.stringify({ id: randomUUID(), method: "events.subscribe", params: { subscriptions: [
        { type: "pane.closed" }, { type: "pane.exited" }, { type: "pane.created" },
        { type: "workspace.closed" }, { type: "workspace.renamed" },
      ] } })}\n`);
    }).catch((error: unknown) => { if (!closed) onDown(error instanceof Error ? error.message : String(error)); });
    return { close };
  }
}
