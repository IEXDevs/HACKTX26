import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = new URL("../apps/web/node_modules/vitest/vitest.mjs", import.meta.url);
const result = spawnSync(process.execPath, [fileURLToPath(cli), "run", "src/lib/runtime/command-runner.integration.test.ts"], {
  cwd: fileURLToPath(new URL("../apps/web", import.meta.url)),
  env: { ...process.env, RUN_SANDBOX_INTEGRATION: "1" }, stdio: "inherit", windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
