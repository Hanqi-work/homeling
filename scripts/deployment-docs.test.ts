import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

describe("documented deployment commands", () => {
  test.each([false, true])("installer persists access configuration without changing Collie (existing agent: %s)", async (existingAgent) => {
    const home = await mkdtemp(join(tmpdir(), "homeling-deployment-"));
    try {
      const bin = join(home, "bin");
      const collie = join(home, ".local/share/collie");
      const agentDir = join(home, "Library/LaunchAgents");
      await mkdir(bin, { recursive: true });
      await mkdir(join(collie, "bin"), { recursive: true });
      if (existingAgent) {
        await mkdir(agentDir, { recursive: true });
        await writeFile(join(agentDir, "herdr.collie.plist"), "protected Collie agent");
      }
      const collieBinary = join(collie, "bin/collie");
      await writeFile(collieBinary, "protected Collie binary");
      await writeFile(join(bin, "bun"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      await writeFile(join(bin, "launchctl"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$HOME/launchctl-calls"\n', { mode: 0o755 });
      const process = Bun.spawn(["bash", join(root, "scripts/install-launchd.sh")], {
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          HOME: home,
          HOMELING_REPO: root,
          HOMELING_PORT: "8790",
          HOMELING_TRUSTED_USERS: "test@example.com,second@example.com",
          HOMELING_TAILSCALE_HOST: "test-mac.tail0000.ts.net",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()]);
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      const plist = await readFile(join(agentDir, "com.homeling.daemon.plist"), "utf8");
      expect(plist).toContain(`<string>${bin}/bun</string>`);
      expect(plist).toContain(`<string>${root}/apps/daemon/src/index.ts</string>`);
      expect(plist).toContain("<key>HOMELING_PORT</key><string>8790</string>");
      expect(plist).toContain("<key>HOMELING_TRUSTED_USERS</key><string>test@example.com,second@example.com</string>");
      expect(plist).toContain("<key>HOMELING_TAILSCALE_HOST</key><string>test-mac.tail0000.ts.net</string>");
      expect(plist).toContain("<key>KeepAlive</key><true/>");
      const calls = await readFile(join(home, "launchctl-calls"), "utf8");
      expect(calls).toContain("/com.homeling.daemon");
      expect(calls).toContain(`bootstrap gui/`);
      expect(calls).not.toContain("herdr.collie");
      expect(await readFile(collieBinary, "utf8")).toBe("protected Collie binary");
      if (existingAgent) {
        expect(await readFile(join(agentDir, "herdr.collie.plist"), "utf8")).toBe("protected Collie agent");
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  test("README commands resolve to repository scripts and CI checks", async () => {
    const readme = await Bun.file(join(root, "README.md")).text();
    const commands = [...readme.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]!).join("\n");
    const scripts = [...commands.matchAll(/bash (scripts\/[\w-]+\.sh)/g)].map((match) => match[1]!);
    expect(scripts).toContain("scripts/install-launchd.sh");
    expect(scripts).toContain("scripts/build-web.sh");
    expect(scripts).toContain("scripts/canary.sh");
    for (const script of scripts) expect(existsSync(join(root, script))).toBe(true);

    const pkg = await Bun.file(join(root, "package.json")).json();
    const ci = await Bun.file(join(root, ".github/workflows/ci.yml")).text();
    for (const command of ["bun install --frozen-lockfile", "bun run typecheck", "bun test", "bun run build"]) {
      expect(commands).toContain(command);
      expect(ci).toContain(`run: ${command}`);
    }
    for (const match of commands.matchAll(/^bun run ([\w:-]+)$/gm)) {
      expect(pkg.scripts[match[1]!]).toBeDefined();
    }
    expect(commands).toContain("tailscale serve --bg --https=443 --set-path=/lite/ 8790");
    expect(commands).toContain("tailscale serve --https=443 --set-path=/lite/ off");
    expect(commands).not.toMatch(/tailscale (?:serve reset|funnel)/);
    expect(commands).not.toContain("install:launchd");
  });
});
