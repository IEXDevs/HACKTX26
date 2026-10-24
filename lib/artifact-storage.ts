import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, link, unlink } from 'node:fs/promises';
import path from 'node:path';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const root = () => path.resolve(process.env.RELAY_ARTIFACT_DIR || '.data/artifacts');

export async function putObject(key: string, bytes: Buffer, _mime: string, fixture: boolean) {
  const name = fixture ? key.replaceAll('/', '_') : Buffer.from(key).toString('base64url');
  if (path.basename(name) !== name || !name || name === '.' || name === '..')
    throw new Error('Invalid artifact key');
  await mkdir(root(), { recursive: true });
  const target = path.join(root(), name);
  const temporary = target + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    // Publish a complete file atomically. Never overwrite a stable action result.
    try {
      await link(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (digest(await readFile(target)) !== digest(bytes))
        throw new Error('Stable artifact key has different content');
    }
  } finally {
    await unlink(temporary);
  }
  return (fixture ? 'fixture://' : 'local://') + name;
}

export async function getObject(uri: string) {
  const prefix = uri.startsWith('fixture://')
    ? 'fixture://'
    : uri.startsWith('local://')
      ? 'local://'
      : '';
  if (!prefix) throw new Error('Storage provider retired or unsupported');
  const name = uri.slice(prefix.length);
  if (!name || name === '.' || name === '..' || /[/\\]/.test(name) || path.basename(name) !== name)
    throw new Error('Invalid artifact path');
  return readFile(path.join(root(), name));
}
