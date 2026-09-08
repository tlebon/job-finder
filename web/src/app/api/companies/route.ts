import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { slugifyCompany } from '@/lib/companies';

/**
 * Companies with live postings, most promising first.
 *
 * Anthropic alone has hundreds of listings; seeing them together is a different
 * question from scrolling a merged list, and it is the view that answers "what
 * else is open here" after applying to one of them.
 */

interface Row {
  company: string; total: number; strong: number; applied: number;
  approved: number; best: number | null;
}

export async function GET() {
  const rows = db.prepare(`
    SELECT company,
           COUNT(*) total,
           SUM(ai_suggestion IN ('STRONG_FIT','GOOD_FIT')) strong,
           SUM(status = 'APPLIED') applied,
           SUM(status = 'APPROVED') approved,
           MAX(COALESCE(model_score, 0)) best
    FROM jobs
    WHERE status NOT IN ('NOT_FIT','ARCHIVED','DEAD','EXPIRED')
      AND company IS NOT NULL AND company <> ''
    GROUP BY company
    HAVING total > 0
    ORDER BY strong DESC, best DESC
  `).all() as Row[];

  // Casing and punctuation vary between sources, so two rows can share a slug.
  // The per-company page aggregates by slug, and the list has to agree with it.
  const merged = new Map<string, { slug: string; company: string; total: number;
    strong: number; applied: number; approved: number }>();
  for (const r of rows) {
    const slug = slugifyCompany(r.company);
    const seen = merged.get(slug);
    if (!seen) {
      merged.set(slug, {
        slug, company: r.company, total: r.total, strong: r.strong ?? 0,
        applied: r.applied ?? 0, approved: r.approved ?? 0,
      });
      continue;
    }
    seen.total += r.total;
    seen.strong += r.strong ?? 0;
    seen.applied += r.applied ?? 0;
    seen.approved += r.approved ?? 0;
  }

  return NextResponse.json({ companies: [...merged.values()] });
}
