import { expect, test } from "bun:test";
import { SessionController } from "./session-controller.ts";
const secret = "a".repeat(43);
function req(path: string, body?: string, cookie?: string) {
  return new Request(`https://home.ts.net/lite/api/session${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin: "https://home.ts.net", "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body });
}
test("credential corruption or local rotation revokes already-admitted operations at their next commit", async () => {
  let verify: (((input: string) => boolean) & { fingerprint?: string }) | null = Object.assign((input: string) => input === secret, { fingerprint: "v1" });
  const controller = new SessionController({ verify: () => verify });
  const response = (await controller.handle(req("/unlock", JSON.stringify({ secret })), "alice"))!;
  const cookie = response.headers.get("set-cookie")!.split(";", 1)[0]!;
  const admission = controller.admission(req("", undefined, cookie), "alice");
  verify = null;
  expect(() => admission.dispatch(() => "write")).toThrow("session.locked");
  expect(() => controller.admission(req("", undefined, cookie), "alice")).toThrow("session.locked");
});

test("unlock alone mints a strict HTTPS cookie; polls and activity never resurrect a locked session", async () => {
  const controller = new SessionController({ verify: () => (input) => input === secret });
  expect((await controller.handle(req(""), "alice"))!.status).toBe(200);
  const response = (await controller.handle(req("/unlock", JSON.stringify({ secret })), "alice"))!;
  expect(response.status).toBe(200);
  const setCookie = response.headers.get("set-cookie")!;
  expect(setCookie).toContain("__Secure-homeling_session=");
  for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/lite/"]) expect(setCookie).toContain(flag);
  const cookie = setCookie.split(";", 1)[0]!;
  expect(controller.admission(req("", undefined, cookie), "alice")).toBeDefined();
  await controller.handle(req("/lock", "{}", cookie), "alice");
  expect(() => controller.admission(req("", undefined, cookie), "alice")).toThrow("session.locked");
  expect((await controller.handle(req("/activity", "{}", cookie), "alice"))!.status).toBe(423);
});
