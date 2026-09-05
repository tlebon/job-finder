import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * Active jobs, for attaching a pasted form to the role it belongs to.
 *
 * Without the link a question is just text. With it, prior answers can be
 * retrieved by how similar the *company* is - which is what makes "Why
 * Langfuse?" find what was written for Proton rather than for whoever happened
 * to ask the same words.
 */
export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim();

  const rows = db.prepare(`
    SELECT id, title, company, location, source, ai_suggestion, ai_reach
    FROM jobs
    WHERE status NOT IN ('NOT_FIT', 'ARCHIVED', 'DEAD', 'EXPIRED')
      ${q ? 'AND (company LIKE @like COLLATE NOCASE OR title LIKE @like COLLATE NOCASE)' : ''}
    ORDER BY
      CASE ai_suggestion WHEN 'STRONG_FIT' THEN 0 WHEN 'GOOD_FIT' THEN 1
                         WHEN 'MAYBE' THEN 2 ELSE 3 END,
      COALESCE(model_score, 0) DESC
    LIMIT 20
  `).all(q ? { like: `%${q}%` } : {}) as {
    id: string; title: string; company: string; location: string;
    source: string; ai_suggestion: string | null; ai_reach: string | null;
  }[];

  return NextResponse.json({
    jobs: rows.map(r => ({
      id: r.id, title: r.title, company: r.company, location: r.location,
      source: r.source, suggestion: r.ai_suggestion ?? undefined, reach: r.ai_reach ?? undefined,
    })),
  });
}
