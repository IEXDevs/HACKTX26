import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runIsolatedCommand } from "./command-runner";

describe.skipIf(process.env.RUN_SANDBOX_INTEGRATION !== "1")("live Docker isolation", () => {
  let temporary: string;
  let root: string;
  beforeAll(() => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "astronom-container-test-"));
    root = path.join(temporary, "agent");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(temporary, "host-only.txt"), "host marker");
  });
  afterAll(() => fs.rmSync(temporary, { recursive: true, force: true }));

  it("can read and write the mounted workspace", async () => {
    fs.writeFileSync(path.join(root, "write.js"), "require('node:fs').writeFileSync('result.txt', 'verified');");
    expect(await runIsolatedCommand(root, "node write.js", 20_000)).toMatchObject({ code: 0 });
    expect(fs.readFileSync(path.join(root, "result.txt"), "utf8")).toBe("verified");
  }, 30_000);

  it("cannot read host files, write the container root, or inherit provider secrets", async () => {
    fs.writeFileSync(path.join(root, "boundaries.js"), `
      const fs = require('node:fs');
      for (const file of [${JSON.stringify(path.join(temporary, "host-only.txt"))}, '/var/run/docker.sock']) {
        try { fs.readFileSync(file); process.exit(10); } catch {}
      }
      try { fs.writeFileSync('/outside-workspace', 'bad'); process.exit(11); } catch {}
      if (process.env.OPENAI_API_KEY || process.env.DATABASE_URL) process.exit(12);
      console.log('boundaries verified');
    `);
    expect(await runIsolatedCommand(root, "node boundaries.js", 20_000)).toMatchObject({ code: 0, stdout: expect.stringContaining("boundaries verified") });
  }, 30_000);

  it("has no network route to the Internet", async () => {
    fs.writeFileSync(path.join(root, "network.js"), `
      const socket = require('node:net').connect(53, '1.1.1.1');
      socket.on('connect', () => process.exit(10));
      socket.on('error', () => process.exit(0));
      setTimeout(() => { socket.destroy(); process.exit(0); }, 1000);
    `);
    expect(await runIsolatedCommand(root, "node network.js", 20_000)).toMatchObject({ code: 0 });
  }, 30_000);
});
