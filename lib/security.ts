import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError, workspaceId } from './config';
import { pool } from './db';
export const id = (prefix: string) => `${prefix}_${randomBytes(12).toString('hex')}`;
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const appOrigin = (req: Request) =>
  new URL(
    process.env.APP_URL ||
      `${new URL(req.url).protocol}//${req.headers.get('host') || new URL(req.url).host}`,
  ).origin;
export function equal(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /secret|password|authorization|api.?key|token$|base64|email|phone/i.test(k)
          ? '[REDACTED]'
          : redact(v),
      ]),
    );
  if (typeof value === 'string') {
    let s = value
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED EMAIL]')
      .replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, '[REDACTED PHONE]')
      .replace(/Bearer\s+[\w.\-]+/gi, 'Bearer [REDACTED]');
    for (const key of [
      'GEMINI_API_KEY',
      'MUSE_API_KEY',
      'SERPAPI_API_KEY',
      'SNOWFLAKE_TOKEN',
      'CONNECTOR_SECRET',
      'DASHBOARD_PASSWORD',
      'SESSION_SECRET',
    ]) {
      const secret = process.env[key];
      if (secret && secret.length >= 4) s = s.split(secret).join('[REDACTED]');
    }
    return s.slice(0, 30000);
  }
  return value;
}
const isLoopback = (req: Request) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(req.url).hostname) &&
  ['localhost', '127.0.0.1', '[::1]'].includes((req.headers.get('host') || '').split(':')[0]);
function sessionSecret() {
  return (
    process.env.SESSION_SECRET ||
    (process.env.NODE_ENV !== 'production' ? 'local-development-only' : '')
  );
}
export function makeSession() {
  const expiry = String(Date.now() + 8 * 3600000);
  return `${expiry}.${createHmac('sha256', sessionSecret()).update(expiry).digest('hex')}`;
}
function sessionValid(req: Request) {
  const value = req.headers
    .get('cookie')
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('relay_session='))
    ?.slice(14);
  if (!value || !sessionSecret()) return false;
  const [exp, sig] = value.split('.');
  return (
    Number(exp) > Date.now() &&
    equal(sig || '', createHmac('sha256', sessionSecret()).update(exp).digest('hex'))
  );
}
export async function authorize(req: Request, scope = 'runs:read', dashboardOnly = false) {
  const bearer = req.headers.get('authorization');
  if (bearer?.startsWith('Bearer ') && !dashboardOnly) {
    const r = await pool.query(
      'SELECT workspace_id,scopes FROM api_keys WHERE key_hash=$1 AND revoked_at IS NULL',
      [hash(bearer.slice(7))],
    );
    if (!r.rows[0] || !r.rows[0].scopes.includes(scope))
      throw new HttpError(403, 'API key lacks this scope');
    return { workspace: r.rows[0].workspace_id as string, kind: 'api' as const };
  }
  if (
    !sessionValid(req) &&
    !(process.env.NODE_ENV !== 'production' && !process.env.DASHBOARD_PASSWORD && isLoopback(req))
  )
    throw new HttpError(401, 'Sign in to your workspace');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.get('origin');
    const expected = appOrigin(req);
    if (origin !== expected)
      throw new HttpError(403, 'Dashboard mutations require the configured same origin');
  }
  return { workspace: workspaceId(), kind: 'dashboard' as const };
}
export function safeError(error: unknown) {
  if (error instanceof HttpError) return { status: error.status, message: error.message };
  if (error instanceof Error && error.name === 'ZodError')
    return { status: 400, message: 'Request did not match the documented schema' };
  console.error(
    'Request failed:',
    error instanceof Error ? String(redact(error.message)) : 'unknown error',
  );
  return {
    status: 500,
    message: 'Request failed. Check server logs; credentials and raw provider errors are hidden.',
  };
}
