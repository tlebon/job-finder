import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

const slugify = (s: string) =>
  (s || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

interface Row {
  id: string; question_text: string; kind: string; company: string | null;
  job_id: string | null; ats: string | null; length_limit: string | null;
  answer: string | null; provenance: string | null;
}

/**
 * One application's questions, plus the material to answer them with.
 *
 * Evidence chunks come from Tim's resumes - compressed facts rather than
 * argument, and exactly what "what's the best evidence you'd be great" wants.
 * Shown beside the answer box rather than inserted into it: reference, not a
 * draft. Retrieval-first is the whole point - his words come back, they do not
 * get rewritten.
 */
export async function GET(_: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;

  const all = db.prepare(`
    SELECT id, question_text, kind, company, job_id, ats, length_limit, answer, provenance
    FROM application_questions
    WHERE kind <> 'mechanical'
    ORDER BY (answer IS NULL OR answer = '') DESC, created_at
  `).all() as Row[];

  const mine = all.filter(r => slugify(r.company ?? 'unknown') === slug);
  if (!mine.length) return NextResponse.json({ error: 'no such application' }, { status: 404 });

  // Previous answers to the same question elsewhere. Weak matching for now: it
  // keys on the question with the company name removed, which fails across
  // "Why Granola?" and "Why do you care about Langfuse?" - same family, no
  // shared words. Company similarity is the right key and needs the posting
  // embeddings.
  const strip = (t: string, c?: string | null) => {
    let s = t.toLowerCase();
    if (c && c.length >= 3) s = s.split(c.toLowerCase()).join(' ');
    return s.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  };

  const evidence = db.prepare(`
    SELECT id, content, source_date, role_track FROM chunks
    WHERE slot = 'evidence' ORDER BY source_date DESC, content
  `).all() as { id: string; content: string; source_date: string; role_track: string }[];

  return NextResponse.json({
    company: mine[0].company ?? 'Unfiled',
    jobId: mine[0].job_id ?? undefined,
    ats: mine[0].ats ?? undefined,
    questions: mine.map(r => ({
      id: r.id,
      question: r.question_text,
      kind: r.kind,
      lengthLimit: r.length_limit ?? undefined,
      answer: r.answer ?? undefined,
      previous: all
        .filter(o => o.id !== r.id && o.answer && strip(o.question_text, o.company) === strip(r.question_text, r.company))
        .map(o => ({ company: o.company ?? 'another application', answer: o.answer })),
    })),
    evidence: evidence.map(e => ({
      id: e.id, content: e.content, date: e.source_date, track: e.role_track,
    })),
  });
}
