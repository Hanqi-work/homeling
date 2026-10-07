import { describe, expect, test } from "bun:test";
import { parseServeStatusRootProxy, parseGitStatusPorcelain } from "./canary.ts";

describe("parseServeStatusRootProxy", () => {
  test("extracts the / proxy from a real `tailscale serve status --json` payload", () => {
    const payload = `{
      "TCP": { "443": { "HTTPS": true } },
      "Web": {
        "rolexdemacbook-air.tail616cc1.ts.net:443": {
          "Handlers": {
            "/": { "Proxy": "http://127.0.0.1:8787" },
            "/lite/": { "Proxy": "http://127.0.0.1:8790" }
          }
        }
      }
    }`;
    expect(parseServeStatusRootProxy(payload)).toBe("http://127.0.0.1:8787");
  });

  test("returns null when no root handler exists", () => {
    const payload = `{"Web":{"h:443":{"Handlers":{"/lite/":{"Proxy":"http://127.0.0.1:8790"}}}}}`;
    expect(parseServeStatusRootProxy(payload)).toBeNull();
  });

  test("returns null on malformed JSON", () => {
    expect(parseServeStatusRootProxy("not json")).toBeNull();
    expect(parseServeStatusRootProxy("{}")).toBeNull();
  });
});

describe("parseGitStatusPorcelain", () => {
  test("empty output is clean", () => {
    expect(parseGitStatusPorcelain("")).toEqual([]);
  });

  test("parses dirty entries", () => {
    const out = " M bridge/server.ts\n?? patches/evil.patch\n";
    expect(parseGitStatusPorcelain(out)).toEqual([" M bridge/server.ts", "?? patches/evil.patch"]);
  });

  test("whitespace-only output is clean", () => {
    expect(parseGitStatusPorcelain("\n\n")).toEqual([]);
  });
});
