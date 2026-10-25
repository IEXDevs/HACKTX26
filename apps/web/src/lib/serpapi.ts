import { env, serpApiEnabled } from "./env";

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export async function serpSearch(input: {
  query: string;
  engine?: string;
  num?: number;
}): Promise<WebSearchHit[]> {
  if (!serpApiEnabled()) {
    throw new Error("SERPAPI_API_KEY is not set. Add it to .env.local, then restart.");
  }
  const query = input.query.trim();
  if (query.length < 2) throw new Error("web.search needs a query.");
  const engine = input.engine === "google_news" ? "google_news" : "google";
  const num = Math.min(10, Math.max(1, Math.floor(input.num ?? 5)));
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("engine", engine);
  url.searchParams.set("num", String(num));
  url.searchParams.set("api_key", env.serpapi.apiKey);

  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = typeof body.error === "string" ? body.error : `SerpAPI ${response.status}`;
    throw new Error(error);
  }
  const organic = Array.isArray(body.organic_results) ? body.organic_results : [];
  const news = Array.isArray(body.news_results) ? body.news_results : [];
  const rows = (engine === "google_news" ? news : organic).slice(0, num);
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const title = typeof item.title === "string" ? item.title : "";
    const link = typeof item.link === "string" ? item.link : "";
    if (!title || !link) return [];
    const snippet =
      (typeof item.snippet === "string" && item.snippet) ||
      (typeof item.date === "string" && item.date) ||
      "";
    return [{ title, url: link, snippet }];
  });
}
