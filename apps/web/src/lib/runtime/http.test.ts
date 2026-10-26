import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchAllowedText, readLimitedText } from "./http";

describe("HTTP egress", () => {
  let server: Server;
  let origin: string;
  let blockedRequests = 0;
  const allowedHosts = new Set(["127.0.0.1"]);
  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === "/allowed") response.writeHead(302, { location: "/text" }).end();
      else if (request.url === "/blocked") response.writeHead(302, { location: `${origin.replace("127.0.0.1", "localhost")}/private` }).end();
      else if (request.url === "/loop") response.writeHead(307, { location: "/loop" }).end();
      else if (request.url === "/protocol") response.writeHead(302, { location: "file:///etc/passwd" }).end();
      else if (request.url === "/slow") { /* Leave the connection open until the client times out. */ }
      else if (request.url === "/large") response.end("x".repeat(512 * 1024));
      else if (request.url === "/private") { blockedRequests++; response.end("private"); }
      else response.end("allowed text");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No HTTP fixture port.");
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("follows an allowed relative redirect", async () => {
    expect(await fetchAllowedText(`${origin}/allowed`, { allowedHosts })).toMatchObject({ ok: true, text: "allowed text", truncated: false });
  });
  it("rejects a redirected host before contacting it", async () => {
    await expect(fetchAllowedText(`${origin}/blocked`, { allowedHosts })).rejects.toThrow('Host "localhost"');
    expect(blockedRequests).toBe(0);
  });
  it("rejects non-HTTP redirects", async () => {
    await expect(fetchAllowedText(`${origin}/protocol`, { allowedHosts })).rejects.toThrow("Only http(s)");
  });
  it("bounds redirect loops", async () => {
    await expect(fetchAllowedText(`${origin}/loop`, { allowedHosts, maxRedirects: 2 })).rejects.toThrow("redirect limit");
  });
  it("limits downloaded response bytes", async () => {
    const result = await fetchAllowedText(`${origin}/large`, { allowedHosts, maxBytes: 1024 });
    expect(result.text).toHaveLength(1024);
    expect(result.truncated).toBe(true);
  });
  it("aborts a stalled request", async () => {
    await expect(fetchAllowedText(`${origin}/slow`, { allowedHosts, timeoutMs: 30 })).rejects.toThrow();
  });
  it("cancels a streaming reader at the byte limit", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new TextEncoder().encode("éééé")); },
      cancel() { cancelled = true; },
    });
    const result = await readLimitedText(new Response(body), 4);
    expect(result).toEqual({ text: "éé", truncated: true });
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });
});
