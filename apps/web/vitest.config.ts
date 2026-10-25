import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Tests that touch the database get a private in-memory copy with the real migrations.
    // Tests that run the engine write agent sandboxes under the system temp directory.
    env: {
      DATABASE_URL: ":memory:",
      MODEL_GATEWAY: "scripted",
      SANDBOX_ROOT: path.join(os.tmpdir(), "astronom-test-sandboxes"),
    },
  },
});
