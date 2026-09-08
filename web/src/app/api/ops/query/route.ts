import { db } from '@/lib/db';

/**
 * Read-only queries over HTTPS, so routine inspection does not need SSH.
 *
 * Railway's SSH gateway refuses a second connection with "duplicate session:
 * remote-work" when a previous one has not closed cleanly - which detached
 * background commands cause routinely - and it blocked roughly half of all
 * attempts to look at the database. HTTPS has none of that state.
 *
 * SELECT and PRAGMA only, on a connection with no write path, capped and
 * token-gated with the same secret as the export endpoint. It is an operational
 * tool, not a feature: nothing in the app calls it.
 */

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * A single read. Rejecting anything else is belt-and-braces beside the
 * read-only handle, since a rejected statement is a clearer failure than one
 * that silently does nothing.
 */
function isReadOnly(sql: string): boolean {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  if (/;/.test(trimmed)) return false;                       // one statement only
  if (!/^(select|pragma|with)\b/i.test(trimmed)) return false;
  return !/\b(insert|update|delete|drop|alter|create|attach|replace|vacuum)\b/i.test(trimmed);
}

export async function POST(request: Request) {
  const expected = process.env.EXPORT_TOKEN;
  if (!expected) return new Response('EXPORT_TOKEN is not configured\n', { status: 503 });

  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!safeEqual(provided, expected)) return new Response('Unauthorized\n', { status: 401 });

  const { sql, limit } = await request.json();
  if (typeof sql !== 'string' || !isReadOnly(sql)) {
    return Response.json({ error: 'a single SELECT, WITH or PRAGMA statement only' }, { status: 400 });
  }

  try {
    const rows = db.prepare(sql).all() as Record<string, unknown>[];
    const capped = rows.slice(0, Math.min(Number(limit) || 200, 2000));
    return Response.json({ rows: capped, total: rows.length, truncated: rows.length > capped.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
