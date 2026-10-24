import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchWeb } from '../lib/serpapi';
import { ConnectorError, connectorFailure, connectorFailureMessage } from '../lib/connector-errors';

const prior = process.env.SERPAPI_API_KEY;
afterEach(() => {
  vi.unstubAllGlobals();
  if (prior === undefined) delete process.env.SERPAPI_API_KEY;
  else process.env.SERPAPI_API_KEY = prior;
});
describe('SerpAPI evidence and safe failures', () => {
  it('keeps the task query, source IDs, and live evidence without leaking the API key', async () => {
    process.env.SERPAPI_API_KEY = 'isolated-test-search-secret';
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        search_metadata: { id: 'test-search' },
        organic_results: [
          {
            title: 'Hardware source',
            link: 'https://example.com/hardware',
            snippet: 'Source excerpt',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const result = await searchWeb('innovative hardware for a workshop');
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('q')).toBe(result.query);
    expect(result.searchId).toBe('test-search');
    expect(result.evidence[0]).toMatchObject({
      fixture: false,
      url: 'https://example.com/hardware',
    });
    expect(JSON.stringify(result)).not.toContain(process.env.SERPAPI_API_KEY);
  });
  it.each([
    ['EACCES', 'SEARCH_NETWORK_DENIED'],
    ['EPERM', 'SEARCH_NETWORK_DENIED'],
    ['ECONNRESET', 'SEARCH_NETWORK_FAILED'],
  ])(
    'classifies network failure %s without exposing raw provider details',
    async (code, expected) => {
      process.env.SERPAPI_API_KEY = 'isolated-test-search-secret';
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new TypeError('raw URL with secret', { cause: { code } })),
      );
      await expect(searchWeb('hardware research query')).rejects.toMatchObject({ code: expected });
    },
  );
  it('classifies a timeout', async () => {
    process.env.SERPAPI_API_KEY = 'isolated-test-search-secret';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('secret', 'TimeoutError')));
    await expect(searchWeb('hardware research query')).rejects.toMatchObject({
      code: 'SEARCH_TIMEOUT',
    });
  });
  it.each([
    [401, 'SEARCH_AUTH_FAILED'],
    [403, 'SEARCH_AUTH_FAILED'],
    [429, 'SEARCH_RATE_LIMITED'],
    [500, 'SEARCH_PROVIDER_FAILED'],
  ])('classifies HTTP %s without passing its raw body', async (status, code) => {
    process.env.SERPAPI_API_KEY = 'isolated-test-search-secret';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('raw provider secret', { status: Number(status) })),
    );
    await expect(searchWeb('hardware research query')).rejects.toMatchObject({ code });
  });
  it('rejects malformed responses and does not substitute fixture evidence', async () => {
    process.env.SERPAPI_API_KEY = 'isolated-test-search-secret';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ organic_results: [{ title: 'Missing URL' }] })),
    );
    await expect(searchWeb('hardware research query')).rejects.toMatchObject({
      code: 'SEARCH_INVALID_RESPONSE',
    });
  });
  it('distinguishes empty evidence and missing credentials', async () => {
    process.env.SERPAPI_API_KEY = 'isolated-test-search-secret';
    const fetcher = vi.fn().mockResolvedValue(Response.json({ organic_results: [] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(searchWeb('hardware research query')).rejects.toMatchObject({
      code: 'SEARCH_NO_RESULTS',
    });
    delete process.env.SERPAPI_API_KEY;
    await expect(searchWeb('hardware research query')).rejects.toMatchObject({
      code: 'SEARCH_NOT_CONFIGURED',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('only exposes fixed connector messages across MCP', () => {
    const payload = connectorFailure(new ConnectorError('SEARCH_NETWORK_DENIED'));
    expect(connectorFailureMessage([{ type: 'text', text: JSON.stringify(payload) }])).toContain(
      'outbound HTTPS',
    );
    const raw = connectorFailure(new Error('secret provider URL'));
    expect(JSON.stringify(raw)).not.toContain('secret provider URL');
    for (const code of ['unknown-secret', '__proto__']) {
      const message = connectorFailureMessage([
        { type: 'text', text: JSON.stringify({ error: { code, message: 'secret' } }) },
      ]);
      expect(message).not.toContain('secret');
    }
  });
});
