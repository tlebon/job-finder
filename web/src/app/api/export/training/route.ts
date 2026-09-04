import { db } from '@/lib/db';

/**
 * Streams the labelled corpus as JSONL for offline model training.
 *
 * This exists because Railway's SSH cannot carry it. Small commands work, but a
 * large stdout stream makes the CLI try to allocate a terminal and the session
 * collides - so the multi-megabyte export has to travel over HTTPS instead.
 * It is also the better shape regardless: the export will be pulled again every
 * time labels accumulate.
 *
 * Authenticated by a bearer token rather than the session cookie, so it can be
 * curled from a script. Compared in constant time - a timing-sensitive compare
 * on a long-lived secret is cheap to get right and awkward to retrofit.
 */

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface Row {
  title: string; company: string; location: string; source: string;
  description: string; ai_suggestion: string; status: string;
  status_source: string | null; score: number; ai_score_adjustment: number | null;
}

export async function GET(request: Request) {
  const expected = process.env.EXPORT_TOKEN;
  if (!expected) {
    return new Response('EXPORT_TOKEN is not configured\n', { status: 503 });
  }

  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!safeEqual(provided, expected)) {
    return new Response('Unauthorized\n', { status: 401 });
  }

  const url = new URL(request.url);
  const maxChars = Number(url.searchParams.get('chars') ?? 6000);

  // The labelling set is a different population - it includes rows the gate
  // rejected, which never reach the jobs table - and it carries Tim's own
  // verdicts, which are the only ground truth here.
  if (url.searchParams.get('set') === 'labels') {
    const labelled = db.prepare(`
      SELECT title, company, location, source, description, url,
             gate_passed, regex_score, sampling_prob, stratum,
             human_label, ai_suggestion, ai_score_adjustment
      FROM label_sample
    `).all() as Record<string, unknown>[];

    const body = labelled.map(r => JSON.stringify({
      ...r,
      text: String(r.description ?? '').slice(0, maxChars),
      description: undefined,
    })).join('\n');

    return new Response(body, {
      headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
    });
  }

  const rows = db.prepare(`
    SELECT title, company, location, source, description,
           ai_suggestion, status, status_source, score, ai_score_adjustment
    FROM jobs
    WHERE ai_suggestion IS NOT NULL
      AND description IS NOT NULL AND LENGTH(description) > 200
  `).all() as Row[];

  // Streamed rather than assembled: the full corpus is tens of megabytes and
  // building one string would hold all of it in memory at once.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const r of rows) {
        controller.enqueue(encoder.encode(JSON.stringify({
          title: r.title,
          company: r.company,
          location: r.location,
          source: r.source,
          text: (r.description ?? '').slice(0, maxChars),
          label: r.ai_suggestion,
          good: r.ai_suggestion === 'STRONG_FIT' || r.ai_suggestion === 'GOOD_FIT' ? 1 : 0,
          status: r.status,
          status_source: r.status_source,
          regex_score: r.ai_score_adjustment === null ? null : r.score - r.ai_score_adjustment,
        }) + '\n'));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store',
    },
  });
}
