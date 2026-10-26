import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { ExecResult } from "./sandbox";

const execFileAsync = promisify(execFile);

export function containerArguments(root: string, command: string, name: string, timeoutMs = 30_000): string[] {
  // These values come from the server configuration, never model tool arguments.
  const image = process.env.SANDBOX_IMAGE || "astronom-sandbox:local";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(image)) throw new Error("Invalid SANDBOX_IMAGE.");
  if (root.includes(",") || /[\r\n]/.test(root)) throw new Error("Sandbox paths cannot contain commas or newlines.");
  const user = process.getuid ? `${process.getuid()}:${process.getgid!()}` : "1000:1000";
  if (user.startsWith("0:")) throw new Error("Run the server as a non-root user before executing agent commands.");
  return [
    "run", "--rm", "--pull=never", "--name", name,
    "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
    "--pids-limit=64", "--cpus=1", "--memory=512m", "--memory-swap=512m", "--user", user,
    "--mount", `type=bind,source=${root},target=/workspace`, "--workdir=/workspace",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=67108864",
    "--env", "HOME=/tmp", "--env", "NODE_ENV=test", "--env", "npm_config_cache=/tmp/npm",
    "--env", "npm_config_update_notifier=false", "--env", "npm_config_fund=false", "--env", "npm_config_audit=false",
    "--entrypoint=/usr/bin/timeout", image, "--signal=TERM", "--kill-after=1s", `${Math.max(1, Math.ceil(timeoutMs / 1000))}s`, "/bin/sh", "-c", command,
  ];
}

/** No host fallback: agent code runs only in a constrained, networkless container. */
export async function runIsolatedCommand(root: string, command: string, timeoutMs: number): Promise<ExecResult> {
  const name = `astronom-${randomUUID()}`;
  const args = containerArguments(root, command, name, timeoutMs);
  try {
    const { stdout, stderr } = await execFileAsync("docker", args, { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true });
    return { code: 0, stdout, stderr, timedOut: false };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; message?: string };
    return {
      code: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.code === "ENOENT" ? "Isolated command execution requires Docker. Build the sandbox image with pnpm sandbox:build. Host execution is disabled." : failure.stderr || failure.message || "Isolated command failed.",
      timedOut: Boolean(failure.killed) || failure.code === 124,
    };
  } finally {
    // Killing the Docker client alone can leave its container running.
    await execFileAsync("docker", ["rm", "--force", name], { timeout: 5_000, windowsHide: true }).catch(() => undefined);
  }
}
