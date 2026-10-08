import { expect, test } from "bun:test";
import { handleRequest } from "./index.ts";
import { daemonConfigFromEnv } from "./config.ts";
import { SessionController } from "./session-controller.ts";
const cfg = daemonConfigFromEnv({ HOMELING_TAILSCALE_HOST: "home.ts.net", HOMELING_TRUSTED_USERS: "alice" });
function request(path: string, method = "POST", cookie?: string) {
  return Object.assign(new Request(`https://home.ts.net${path}`, { method, headers: { host: "home.ts.net", origin: "https://home.ts.net", "tailscale-user-login": "alice", "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(method !== "GET" ? { body: "{}" } : {}) }), { remoteAddress: "127.0.0.1" });
}
test("all business writes, unknown routes and loopback are locked with zero upstream effects", async () => {
  let writes = 0;
  const session = new SessionController({ verify: () => null });
  for (const path of ["/lite/api/launch", "/lite/api/pane/p/reply", "/lite/api/pane/p/stop", "/lite/api/pane/p/keys", "/lite/api/requests/r/approve", "/lite/api/persona", "/lite/api/persona/p/memory", "/lite/api/push/subscribe", "/lite/api/stt", "/lite/api/health"]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const result = await handleRequest(request(path, method), cfg, async () => { writes++; return Response.json({ ok: true }); }, undefined, session);
      expect(result.status).toBe(423);
      expect(await result.json()).toMatchObject({ code: "session.locked", executed: false, textDelivered: false, deliveryUnknown: false });
    }
  }
  expect(writes).toBe(0);
});
