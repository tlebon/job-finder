import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { companySection, rankBySimilarity } from '@shared/questions/companySimilarity';
import { learnPreferences, highlight } from '@shared/questions/preferredTerms';

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

  const strip = (t: string, c?: string | null) => {
    let s = t.toLowerCase();
    if (c && c.length >= 3) s = s.split(c.toLowerCase()).join(' ');
    return s.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  };

  /**
   * How much each company Tim has written for resembles this one.
   *
   * The useful prior answer to "Why Langfuse?" is the one written for a company
   * *like* Langfuse, not another "why us" picked at random - so answers are
   * ordered by company similarity rather than by recency or by who happened to
   * phrase a question the same way.
   */
  const blurbs = db.prepare(`
    SELECT DISTINCT q.company, j.description
    FROM application_questions q JOIN jobs j ON j.id = q.job_id
    WHERE q.company IS NOT NULL AND j.description IS NOT NULL
  `).all() as { company: string; description: string }[];

  const here = blurbs.find(b => slugify(b.company) === slug);
  const nearness = new Map<string, number>();
  if (here) {
    for (const { id, score } of rankBySimilarity(
      { id: here.company, text: companySection(here.description) },
      blurbs.filter(b => b.company !== here.company)
            .map(b => ({ id: b.company, text: companySection(b.description) }))
    )) {
      nearness.set(id, score);
    }
  }

  const evidence = db.prepare(`
    SELECT id, content, source_date, role_track FROM chunks
    WHERE slot = 'evidence' ORDER BY source_date DESC, content
  `).all() as { id: string; content: string; source_date: string; role_track: string }[];

  /**
   * The parts of this posting carrying what Tim tends to respond to.
   *
   * His idea, and the labels to estimate it already exist. Weights are the
   * log-odds of a term appearing in a posting he wanted against one he did not
   * - which is not the same as "common in the ones he liked", since "engineer"
   * is in nearly all of both and says nothing.
   *
   * Raw material, never an answer: the posting's own sentences, offered for him
   * to write from.
   */
  let highlights: { sentence: string; matched: string[] }[] = [];
  const posting = here?.description;
  if (posting) {
    const labelled = db.prepare(`
      SELECT description text, human_label FROM label_sample
      WHERE human_label IS NOT NULL AND LENGTH(description) > 400
    `).all() as { text: string; human_label: number }[];

    if (labelled.length > 50) {
      const weights = learnPreferences(labelled.map(r => ({ text: r.text, liked: r.human_label === 1 })));
      highlights = highlight(companySection(posting, 4000), weights, 3)
        .map(h => ({ sentence: h.sentence, matched: h.matched }));
    }
  }

  // Companies Tim has already written for, nearest first. Useful even when no
  // question matches: "you wrote about Proton, which is the closest thing here"
  // is a starting point.
  const neighbours = [...nearness.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([company, score]) => ({ company, similarity: Number(score.toFixed(3)) }));

  return NextResponse.json({
    neighbours,
    highlights,
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
        .map(o => ({
          company: o.company ?? 'another application',
          answer: o.answer,
          // Undefined when there is no posting to compare, which is honest -
          // better than implying a similarity that was never computed.
          similarity: o.company ? nearness.get(o.company) : undefined,
        }))
        .sort((a, b) => (b.similarity ?? -1) - (a.similarity ?? -1)),
    })),
    evidence: evidence.map(e => ({
      id: e.id, content: e.content, date: e.source_date, track: e.role_track,
    })),
  });
}
