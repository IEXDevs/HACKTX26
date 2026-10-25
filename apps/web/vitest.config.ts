import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Tests that touch the database get a private in-memory copy with the real migrations.
    env: { DATABASE_URL: ":memory:", MODEL_GATEWAY: "scripted" },
  },
});
