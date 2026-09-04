import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * The labelling set.
 *
 * gate_passed, regex_score, stratum and source are deliberately NOT returned.
 * This set exists to judge the gate, and a label produced while looking at the
 * gate's opinion is not independent of it. Source is withheld for the same
 * reason: positive rates run from 69% (80,000 Hours) to 10% (RemoteOK), so
 * showing it would anchor the judgement it is meant to be measured against.
 */
export async function GET() {
  const rows = db.prepare(`
    SELECT id, title, company, location, description, display_order
    FROM label_sample
    WHERE human_label IS NULL
    ORDER BY display_order
    LIMIT 40
  `).all();

  const p = db.prepare(`
    SELECT COUNT(*) total, SUM(human_label IS NOT NULL) labelled FROM label_sample
  `).get() as { total: number; labelled: number | null };

  return NextResponse.json({
    items: rows,
    progress: { total: p.total, labelled: p.labelled ?? 0 },
  });
}

export async function POST(request: Request) {
  const { id, label } = await request.json();

  if (typeof id !== 'string' || (label !== 0 && label !== 1 && label !== null)) {
    return NextResponse.json({ error: 'id and label (0, 1 or null) required' }, { status: 400 });
  }

  const result = db.prepare(`
    UPDATE label_sample SET human_label = ?, labelled_at = ? WHERE id = ?
  `).run(label, label === null ? null : new Date().toISOString(), id);

  if (result.changes === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
