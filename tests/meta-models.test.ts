import { afterEach, describe, it, expect, vi } from 'vitest';
import { defaultConfig } from '../lib/config';
import { coordinate, extractRequirements } from '../lib/models';
const prior = process.env.MUSE_API_KEY;
afterEach(() => {
  vi.unstubAllGlobals();
  if (prior === undefined) delete process.env.MUSE_API_KEY;
  else process.env.MUSE_API_KEY = prior;
});
const requirements = {
  title: 'Meetup',
  location: 'UT Austin',
  attendees: 80,
  budget: 3000,
  currency: 'USD',
  date: null,
  preferences: [],
  unknowns: ['Date', 'Venue'],
};
describe('Meta-only model adapter', () => {
  it('extracts a PDF through Meta with a JSON schema and validates the result', async () => {
    process.env.MUSE_API_KEY = 'test-provider-key';
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        choices: [{ message: { content: JSON.stringify(requirements) } }],
        usage: { total_tokens: 123 },
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    expect(
      (
        await extractRequirements(defaultConfig, 'Meetup for 80 people within $3000', {
          mimeType: 'application/pdf',
          base64: 'JVBERi0=',
        })
      ).requirements,
    ).toEqual(requirements);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.model).toBe(defaultConfig.extractionModel);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.messages[0].content[1].file.file_data).toBe('data:application/pdf;base64,JVBERi0=');
    expect(body.store).toBe(false);
  });
  it('offers only permitted SerpAPI search and discards private model reasoning', async () => {
    process.env.MUSE_API_KEY = 'test-provider-key';
    const fetcher = vi.fn().mockImplementation(async () =>
      Response.json({
        choices: [
          { message: { content: 'Visible result', reasoning_content: 'Private reasoning' } },
        ],
        usage: { total_tokens: 9 },
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const result = await coordinate(defaultConfig, [{ role: 'user', content: 'Research venues' }]);
    expect(
      JSON.parse(fetcher.mock.calls[0][1].body).tools.map((t: any) => t.function.name),
    ).toEqual(['venue_search']);
    expect(result.message).toEqual({ role: 'assistant', content: 'Visible result' });
    await coordinate(
      { ...defaultConfig, tools: [] },
      [{ role: 'user', content: 'Write a greeting' }],
      true,
    );
    expect(JSON.parse(fetcher.mock.calls[1][1].body).tools).toBeUndefined();
  });
});
