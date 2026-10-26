import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const docker = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: Object.assign(() => {}, { [Symbol.for("nodejs.util.promisify.custom")]: docker }) }));
import { containerArguments, runIsolatedCommand } from "./command-runner";

describe("isolated commands", () => {
  beforeEach(() => {
    docker.mockReset().mockResolvedValue({ stdout: "ok", stderr: "" });
    if (process.getuid) vi.spyOn(process as { getuid: () => number }, "getuid").mockReturnValue(1000);
    if (process.getgid) vi.spyOn(process as { getgid: () => number }, "getgid").mockReturnValue(1000);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("mounts only the workspace with no network, privilege, or root filesystem writes", () => {
    const args = containerArguments("/workspace/agent", "node check.js", "test_container");
    expect(args).toEqual(expect.arrayContaining(["--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=64", "--memory=512m", "--user", "1000:1000", "--pull=never"]));
    expect(args.filter((arg) => arg.startsWith("type=bind"))).toEqual(["type=bind,source=/workspace/agent,target=/workspace"]);
    expect(args).not.toContain("--privileged");
    expect(args).not.toContain("--env-file");
    expect(args).toContain("--entrypoint=/usr/bin/timeout");
    expect(args).toContain("30s");
    expect(args.slice(-3)).toEqual(["/bin/sh", "-c", "node check.js"]);
  });

  it("uses Docker directly and removes the container after success", async () => {
    expect(await runIsolatedCommand("/workspace/agent", "node check.js", 200)).toMatchObject({ code: 0, stdout: "ok" });
    expect(docker.mock.calls[0]![0]).toBe("docker");
    expect(docker.mock.calls[0]![2]).toMatchObject({ timeout: 200, windowsHide: true });
    const args = docker.mock.calls[0]![1] as string[];
    expect(docker.mock.calls[1]![1]).toEqual(["rm", "--force", args[args.indexOf("--name") + 1]]);
  });

  it("removes a container after a timeout without invoking a host shell", async () => {
    docker.mockRejectedValueOnce({ killed: true, stdout: "partial", stderr: "timeout" });
    expect(await runIsolatedCommand("/workspace/agent", "node check.js", 200)).toMatchObject({ code: 1, timedOut: true, stdout: "partial" });
    expect(docker.mock.calls.map((call) => call[0])).toEqual(["docker", "docker"]);
  });

  it("fails closed when Docker is absent", async () => {
    docker.mockRejectedValue({ code: "ENOENT" });
    expect(await runIsolatedCommand("/workspace/agent", "node check.js", 200)).toMatchObject({ code: 1, stderr: expect.stringContaining("Host execution is disabled") });
  });

  it("rejects image and mount option injection", () => {
    expect(() => containerArguments("/workspace/agent,readonly", "node check.js", "test")).toThrow("commas");
    vi.stubEnv("SANDBOX_IMAGE", "--privileged");
    expect(() => containerArguments("/workspace/agent", "node check.js", "test")).toThrow("SANDBOX_IMAGE");
  });
});
