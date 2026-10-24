import { describe, it, expect } from 'vitest';
import { putObject, getObject } from '../lib/artifact-storage';

describe('private persistent disk artifacts', () => {
  it('recovers the existing result for a stable live action and rejects changed content', async () => {
    const key = 'storage-test/' + crypto.randomUUID() + '/approved-brief.json';
    const body = Buffer.from('{"approved":true}');
    const uri = await putObject(key, body, 'application/json', false);
    expect(uri.startsWith('local://')).toBe(true);
    expect(await putObject(key, body, 'application/json', false)).toBe(uri);
    expect(await getObject(uri)).toEqual(body);
    await expect(
      putObject(key, Buffer.from('different content'), 'text/plain', false),
    ).rejects.toThrow('different content');
    expect(await getObject(uri)).toEqual(body);
  });
  it('publishes a complete file once when two identical attempts race', async () => {
    const key = 'storage-test/' + crypto.randomUUID();
    const body = Buffer.alloc(65536, 42);
    const results = await Promise.all([
      putObject(key, body, 'text/plain', false),
      putObject(key, body, 'text/plain', false),
    ]);
    expect(results[0]).toBe(results[1]);
    expect(await getObject(results[0])).toEqual(body);
  });
  it('preserves fixture labels and rejects traversal or retired storage URIs', async () => {
    const uri = await putObject(
      'fixture-test/' + crypto.randomUUID(),
      Buffer.from('fixture'),
      'text/plain',
      true,
    );
    expect(uri.startsWith('fixture://')).toBe(true);
    for (const invalid of [
      'local://../secret',
      'fixture://..\\secret',
      'local://..',
      'gs://retired-bucket/key',
    ])
      await expect(getObject(invalid)).rejects.toThrow();
  });
});
