import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { slugifyCompany } from '@/lib/companies';


interface Row {
  id: string; title: string; company: string; location: string; url: string;
  status: string; score: number; model_score: number | null;
  ai_suggestion: string | null; ai_reach: string | null; date_found: string;
}

const ORDER = ['STRONG_FIT', 'GOOD_FIT', 'MAYBE'];

export async function GET(_: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;

  const all = db.prepare(`
    SELECT id, title, company, location, url, status, score, model_score,
           ai_suggestion, ai_reach, date_found
    FROM jobs
    WHERE status NOT IN ('ARCHIVED','DEAD','EXPIRED')
      AND company IS NOT NULL AND company <> ''
  `).all() as Row[];

  const mine = all.filter(r => slugifyCompany(r.company) === slug);
  if (!mine.length) return NextResponse.json({ error: 'no such company' }, { status: 404 });

  const rank = (r: Row) => {
    const i = ORDER.indexOf(r.ai_suggestion ?? '');
    return i === -1 ? ORDER.length : i;
  };
  mine.sort((a, b) => rank(a) - rank(b) || (b.model_score ?? 0) - (a.model_score ?? 0));

  return NextResponse.json({
    company: mine[0].company,
    // Applying to several roles at one company is normal at Anthropic, where
    // teams hire separately, and reads as unfocused at a company of twelve
    // where one person sees all of them. Only Tim knows which, so this reports
    // and does not decide.
    applied: mine.filter(r => r.status === 'APPLIED').map(r => ({ id: r.id, title: r.title })),
    jobs: mine.filter(r => r.status !== 'NOT_FIT').map(r => ({
      id: r.id, title: r.title, location: r.location, url: r.url, status: r.status,
      suggestion: r.ai_suggestion ?? undefined, reach: r.ai_reach ?? undefined,
      modelScore: r.model_score ?? undefined, dateFound: r.date_found,
    })),
    dismissed: mine.filter(r => r.status === 'NOT_FIT').length,
  });
}
