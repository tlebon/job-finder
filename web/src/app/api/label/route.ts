import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { BATCHES, batchOf } from '@shared/labels/batches';

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

  /**
   * Per-epoch progress, aggregated.
   *
   * A row's own stratum stays withheld for the reason above, but which batch
   * the queue is currently working through is not a per-item hint and hiding it
   * achieves nothing: the triage batch runs at a 0.778 base rate against 0.221
   * and 0.140 for the other two, which anyone notices within a few rows.
   * Naming it makes the skew explicit instead of leaving it an unlabelled
   * confounder - see src/labels/batches.json.
   */
  const counts = db.prepare(`
    SELECT stratum, COUNT(*) total, SUM(human_label IS NOT NULL) labelled
    FROM label_sample GROUP BY stratum
  `).all() as { stratum: string; total: number; labelled: number | null }[];

  const byBatch = new Map(BATCHES.map(b => [b.id, {
    id: b.id, name: b.name, selection: b.selection, blind: b.blind,
    evalEligible: b.evalEligible, use: b.use, total: 0, labelled: 0,
  }]));
  for (const c of counts) {
    const agg = byBatch.get(batchOf(c.stratum).id)!;
    agg.total += c.total;
    agg.labelled += c.labelled ?? 0;
  }

  const next = rows[0] as { display_order: number } | undefined;
  const currentBatch = next
    ? batchOf((db.prepare('SELECT stratum FROM label_sample WHERE display_order = ?')
        .get(next.display_order) as { stratum: string }).stratum).id
    : null;

  return NextResponse.json({
    items: rows,
    progress: { total: p.total, labelled: p.labelled ?? 0 },
    batches: [...byBatch.values()].filter(b => b.total > 0),
    currentBatch,
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
