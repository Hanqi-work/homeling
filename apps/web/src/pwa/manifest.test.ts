import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const WEB_ROOT = join(import.meta.dir, "..", "..");
const manifestPromise = Bun.file(join(WEB_ROOT, "public", "manifest.webmanifest")).json();

describe("manifest.webmanifest", () => {
  test("parses as JSON with PWA-required identity fields", async () => {
    const m = (await manifestPromise) as Record<string, unknown>;
    expect(m.name).toBe("Homeling");
    expect(m.short_name).toBe("Homeling");
    expect(m.start_url).toBe("/lite/");
    expect(m.scope).toBe("/lite/");
    expect(m.display).toBe("standalone");
  });

  test("colors align with the app shell palette (index.css: bg #1a1a1a)", async () => {
    const m = (await manifestPromise) as Record<string, unknown>;
    expect(m.background_color).toBe("#1a1a1a");
    expect(m.theme_color).toBe("#1a1a1a");
  });

  test("declares 192px and 512px icons that exist on disk, including a maskable one", async () => {
    const m = (await manifestPromise) as { icons: Array<{ src: string; sizes: string; type: string; purpose?: string }> };
    const sizes = m.icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    for (const icon of m.icons) {
      expect(existsSync(join(WEB_ROOT, "public", icon.src))).toBe(true);
      expect(icon.type).toBe("image/png");
    }
    const maskable = m.icons.filter((i) => i.purpose?.includes("maskable"));
    expect(maskable.length).toBeGreaterThan(0);
  });
});

describe("index.html PWA wiring", () => {
  const htmlPromise = Bun.file(join(WEB_ROOT, "index.html")).text();

  test("links the manifest and declares theme-color", async () => {
    const h = await htmlPromise;
    expect(h).toContain('<link rel="manifest" href="/lite/manifest.webmanifest" />');
    expect(h).toMatch(/<meta name="theme-color" content="#1a1a1a" \/>/);
  });

  test("declares apple-touch-icon for iOS home screen install", async () => {
    const h = await htmlPromise;
    expect(h).toContain('<link rel="apple-touch-icon" href="/lite/icons/icon-192.png" />');
  });
});
