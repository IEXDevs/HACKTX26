import { pool } from '@/lib/db';
import { appOrigin } from '@/lib/security';
export const dynamic = 'force-dynamic';
const escape = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = (await pool.query('SELECT * FROM event_pages WHERE id=$1', [id])).rows[0];
  if (!page)
    return new Response('Event page not found. It may still need organizer approval.', {
      status: 404,
    });
  const count = (
    await pool.query('SELECT count(*)::int AS n FROM interests WHERE page_id=$1', [id])
  ).rows[0].n;
  const c = page.content;
  return new Response(
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(c.title)} · Relay</title><style>body{font:16px system-ui;background:#f6f7f9;color:#172231;margin:0;padding:8vw}main{max-width:680px;margin:auto;background:white;border:1px solid #dddfe4;padding:48px;border-radius:20px}small{color:#53677a}h1{font-size:40px;letter-spacing:-1.5px;line-height:1.1}p{line-height:1.7}button{background:#415be8;color:white;border:0;border-radius:8px;padding:14px 22px;cursor:pointer}.notice{background:#fff7df;padding:16px;border-radius:8px}#result{color:#25644c}</style></head><body><main><small>RELAY / COMMUNITY EVENTS · ${escape(c.mode.toUpperCase())}</small><h1>${escape(c.title)}</h1><p>${escape(c.description)}</p><p class="notice">${escape(c.status)}. ${escape(c.participantNotice)}</p><p><b>Proposed venue</b><br>${escape(c.venue)}</p><p><b>Date</b><br>${escape(c.date)}</p><form method="POST"><label><input type="checkbox" required> I understand this is a demonstration participant action.</label><p><button>Interested as a demo participant</button></p></form><small>${count} demonstration participants interested. No invitation is sent.</small></main></body></html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      },
    },
  );
}
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const origin = req.headers.get('origin');
  if (origin !== appOrigin(req))
    return new Response('Same-origin action required', { status: 403 });
  if (!(await pool.query('SELECT 1 FROM event_pages WHERE id=$1', [id])).rowCount)
    return new Response('Not found', { status: 404 });
  const cookie =
    req.headers.get('cookie')?.match(/relay_demo_participant=([a-f0-9-]{36})/)?.[1] ||
    crypto.randomUUID();
  await pool.query(
    'INSERT INTO interests(page_id,participant_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [id, cookie],
  );
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/events/' + id,
      'Set-Cookie': `relay_demo_participant=${cookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
    },
  });
}
