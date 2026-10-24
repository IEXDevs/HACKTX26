import { z } from 'zod';
import { ConnectorError } from './connector-errors';
import { hash } from './security';

const searchResponse = z.object({
  organic_results: z.array(
    z.object({ title: z.string(), link: z.url(), snippet: z.string().optional() }),
  ),
  search_metadata: z.object({ id: z.string().optional() }).optional(),
});
export async function searchWeb(query: string) {
  const key = process.env.SERPAPI_API_KEY;
  if (!key) throw new ConnectorError('SEARCH_NOT_CONFIGURED');
  const url = new URL('https://serpapi.com/search.json');
  url.search = new URLSearchParams({
    engine: 'google',
    q: query,
    num: '6',
    api_key: key,
  }).toString();
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(18000) });
  } catch (error) {
    const e = error as { name?: string; cause?: { code?: string; errors?: { code?: string }[] } };
    const codes = [e?.cause?.code, ...(e?.cause?.errors || []).map((c) => c.code)];
    if (codes.some((code) => code === 'EACCES' || code === 'EPERM'))
      throw new ConnectorError('SEARCH_NETWORK_DENIED');
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError')
      throw new ConnectorError('SEARCH_TIMEOUT');
    throw new ConnectorError('SEARCH_NETWORK_FAILED');
  }
  if (response.status === 401 || response.status === 403)
    throw new ConnectorError('SEARCH_AUTH_FAILED');
  if (response.status === 429) throw new ConnectorError('SEARCH_RATE_LIMITED');
  if (!response.ok) throw new ConnectorError('SEARCH_PROVIDER_FAILED');
  let body;
  try {
    body = await response.json();
  } catch {
    throw new ConnectorError('SEARCH_INVALID_RESPONSE');
  }
  if (body?.error) throw new ConnectorError('SEARCH_PROVIDER_FAILED');
  const parsed = searchResponse.safeParse(body);
  if (!parsed.success) throw new ConnectorError('SEARCH_INVALID_RESPONSE');
  if (!parsed.data.organic_results.length) throw new ConnectorError('SEARCH_NO_RESULTS');
  const retrievedAt = new Date().toISOString();
  return {
    query,
    evidence: parsed.data.organic_results.slice(0, 6).map((e, i) => ({
      id: 'serp:' + hash(query).slice(0, 8) + ':' + i,
      source: 'SerpAPI',
      title: e.title,
      url: e.link,
      excerpt: e.snippet || 'No snippet supplied; details need confirmation.',
      fixture: false,
      retrievedAt,
    })),
    searchId: parsed.data.search_metadata?.id,
  };
}
