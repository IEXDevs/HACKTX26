import { TOOL_MANIFEST } from "@agent-os/core";
import { describe, expect, it } from "vitest";
import { astroSessionConfig } from "./astro";
import { DraftSchema } from "./runtime/builder-parse";

type JsonSchema = { type?: string; properties?: Record<string, JsonSchema>; items?: JsonSchema; required?: string[] };

/** Every object lists its properties, and every required field exists. */
function checkSchema(schema: JsonSchema, path: string): void {
  expect(["object", "array", "string", "integer", "number", "boolean"], path).toContain(schema.type);
  if (schema.type === "object") {
    expect(schema.properties, path).toBeTypeOf("object");
    for (const name of schema.required ?? []) expect(schema.properties, `${path}.${name}`).toHaveProperty(name);
    for (const [name, child] of Object.entries(schema.properties ?? {})) checkSchema(child, `${path}.${name}`);
  }
  if (schema.type === "array") checkSchema(schema.items as JsonSchema, `${path}[]`);
}

describe("astroSessionConfig", () => {
  it("offers exactly propose_agent, search_web, and build_agent with valid schemas", async () => {
    const config = await astroSessionConfig();
    expect(config.functions.map((fn) => fn.name)).toEqual(["propose_agent", "search_web", "build_agent"]);
    for (const fn of config.functions) {
      expect(fn.description.length).toBeGreaterThan(10);
      checkSchema(fn.parameters as JsonSchema, fn.name);
    }
  });

  it("mirrors the builder draft, so a filled-in proposal passes DraftSchema", async () => {
    const config = await astroSessionConfig();
    const propose = config.functions.find((fn) => fn.name === "propose_agent")!.parameters as JsonSchema;
    expect(Object.keys(propose.properties!).sort()).toEqual(
      ["apps", "complexity", "goal", "instructions", "name", "summary", "workers"],
    );
    const worker = propose.properties!.workers!.items!;
    expect(Object.keys(worker.properties!)).toEqual(
      expect.arrayContaining(["name", "role", "instructions", "complexity", "tools", "parentIndex"]),
    );
    const tool = TOOL_MANIFEST[0]!.name;
    const args = {
      name: "Order Copier",
      summary: "Copies new orders into a sheet.",
      instructions: "Each morning, copy new order emails into the orders sheet.",
      goal: "Copy today's new orders into the sheet.",
      complexity: "standard",
      apps: ["gmail", "googlesheets"],
      workers: [{ name: "Reader", role: "worker", instructions: "Read new order emails.", complexity: "trivial", tools: [tool] }],
    };
    expect(DraftSchema.safeParse(args).success).toBe(true);
  });

  it("speaks with a voice and keeps JSON out of speech", async () => {
    const config = await astroSessionConfig();
    expect(config.voiceName).toBeTruthy();
    expect(config.systemInstruction).toMatch(/Never read out JSON/);
    expect(config.systemInstruction).toContain(TOOL_MANIFEST[0]!.name);
  });
});
