const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Read at most `limit` bytes and stop downloading the rest. */
export async function readLimitedText(response: Response, limit: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { text: text + decoder.decode(), truncated: false };
      const remaining = limit - bytes;
      text += decoder.decode(value.subarray(0, remaining), { stream: true });
      bytes += value.byteLength;
      if (bytes >= limit) {
        await reader.cancel();
        return { text: text + decoder.decode(), truncated: true };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Apply the same egress policy to every redirect, under one timeout and byte limit. */
export async function fetchAllowedText(raw: string, options: {
  allowedHosts: ReadonlySet<string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}) {
  let url = new URL(raw);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    for (let redirects = 0; ; redirects++) {
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) URLs are fetchable.");
      if (!options.allowedHosts.has(url.hostname)) throw new Error(`Host "${url.hostname}" is not on the egress allowlist.`);
      const response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "astronom-agent-runtime/0.1" },
      });
      const location = response.headers.get("location");
      if (REDIRECTS.has(response.status) && location) {
        await response.body?.cancel();
        if (redirects >= (options.maxRedirects ?? 5)) throw new Error("HTTP redirect limit reached.");
        url = new URL(location, url);
        continue;
      }
      const body = await readLimitedText(response, options.maxBytes ?? 256 * 1024);
      return { ...body, ok: response.ok, status: response.status, statusText: response.statusText, hostname: url.hostname };
    }
  } finally {
    clearTimeout(timer);
  }
}
