import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { randomUUID } from 'node:crypto';

/**
 * The application question bank.
 *
 * Stores what is expensive to reproduce. Mechanical fields - name, email,
 * phone - are recorded when a form is pasted so it stays intact, but are never
 * surfaced for writing; the browser already autofills them.
 */

interface Row {
  id: string; question_text: string; kind: string; company: string | null;
  job_id: string | null; ats: string | null; length_limit: string | null;
  answer: string | null; provenance: string | null; created_at: string | null;
  times_used: number;
}

const shape = (r: Row) => ({
  id: r.id,
  question: r.question_text,
  kind: r.kind,
  company: r.company ?? undefined,
  jobId: r.job_id ?? undefined,
  ats: r.ats ?? undefined,
  lengthLimit: r.length_limit ?? undefined,
  answer: r.answer ?? undefined,
  provenance: r.provenance ?? undefined,
  createdAt: r.created_at ?? undefined,
  timesUsed: r.times_used ?? 0,
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const wants = url.searchParams.get('kind');

  const rows = db.prepare(`
    SELECT q.*, (SELECT COUNT(*) FROM answer_uses u WHERE u.question_id = q.id) times_used
    FROM application_questions q
    WHERE q.kind <> 'mechanical'
      ${wants ? 'AND q.kind = ?' : ''}
    ORDER BY (q.answer IS NULL OR q.answer = '') DESC, times_used DESC, q.created_at DESC
  `).all(...(wants ? [wants] : [])) as Row[];

  return NextResponse.json({ questions: rows.map(shape) });
}

/** Save one answer, or a whole parsed form at once. */
export async function POST(request: Request) {
  const body = await request.json();

  if (Array.isArray(body.fields)) {
    const insert = db.prepare(`
      INSERT INTO application_questions
        (id, normalized_key, question_text, kind, company, job_id, ats, length_limit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const normalize = (t: string) => t.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\b(please|kindly|briefly|tell us|describe|explain|what|why|how|do|you|your|are|is|the|a|an)\b/g, '')
      .replace(/\s+/g, ' ').trim();

    let added = 0;
    const run = db.transaction((fields: Record<string, string>[]) => {
      for (const f of fields) {
        insert.run(randomUUID(), normalize(f.question), f.question, f.kind ?? 'prose',
          body.company ?? null, body.jobId ?? null, body.ats ?? null, f.lengthLimit ?? null);
        added++;
      }
    });
    run(body.fields);
    return NextResponse.json({ added });
  }

  const { id, answer, provenance } = body;
  if (typeof id !== 'string') {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  // last_confirmed moves whenever the answer is touched. Facts rot - salary
  // drifts, availability changes - and a stale answer is worse than none
  // because it gets pasted without rereading.
  db.prepare(`
    UPDATE application_questions
    SET answer = ?, provenance = ?, last_confirmed = ?
    WHERE id = ?
  `).run(answer ?? null, provenance ?? 'tim', answer ? new Date().toISOString() : null, id);

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const r = db.prepare('DELETE FROM application_questions WHERE id = ?').run(id);
  return NextResponse.json({ deleted: r.changes });
}
