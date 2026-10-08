import { daemonConfigFromEnv } from "./config.ts";
import { initializeUnlockCredentials, rotateUnlockCredentials } from "./unlock-credentials.ts";

if (import.meta.main) {
  const action = process.argv[2];
  if (action !== "init" && action !== "rotate") {
    console.error("Usage: bun apps/daemon/src/unlock-credentials-cli.ts init|rotate");
    process.exitCode = 2;
  } else {
    const directory = daemonConfigFromEnv({}).unlockDataDir!;
    try {
      if (action === "init") initializeUnlockCredentials(directory); else rotateUnlockCredentials(directory);
      console.info(`Homeling unlock credentials ${action === "init" ? "initialized" : "rotated"}. Read unlock-secret locally in ${directory}. The secret is never printed.`);
    } catch (error) {
      console.error(`Unlock credentials unavailable: ${error instanceof Error ? error.message : "local state error"}`);
      process.exitCode = 1;
    }
  }
}
