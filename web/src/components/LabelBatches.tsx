'use client';

/**
 * Which labelling epoch the queue is in, and where the others stand.
 *
 * `label_sample` holds three batches drawn under three different rules, and
 * until now the only record of that was the shape of a stratum string. The
 * differences matter: the triage batch runs at a 0.778 base rate against 0.221
 * and 0.140 for the other two, because it is the top of the model's own ranking
 * rather than a random draw. Hiding that does not make labelling blind - the
 * rate is obvious within a few rows - it just leaves the skew unnamed.
 *
 * Per-row provenance stays withheld by /api/label. This is the batch, not the
 * item. Progress counts are shown; observed base rates deliberately are not,
 * since those would anchor the next judgement.
 */

export interface BatchProgress {
  id: string;
  name: string;
  selection: 'probability' | 'ranked';
  blind: 'yes' | 'partial' | 'no';
  evalEligible: boolean;
  use: string;
  total: number;
  labelled: number;
}

const SELECTION_LABEL: Record<BatchProgress['selection'], string> = {
  probability: 'random draw',
  ranked: 'top of the ranking, best first',
};

export function LabelBatches({ batches, currentId }: {
  batches: BatchProgress[];
  currentId: string | null;
}) {
  if (!batches.length) return null;

  return (
    <details className="mt-2 text-xs text-[var(--ink-muted)]">
      <summary className="cursor-pointer select-none">
        {(() => {
          const here = batches.find(b => b.id === currentId);
          return here
            ? `Batch: ${here.name} — ${SELECTION_LABEL[here.selection]}`
            : 'Labelling batches';
        })()}
      </summary>
      <ul className="mt-2 space-y-1.5">
        {batches.map(b => (
          <li
            key={b.id}
            className={b.id === currentId ? 'text-[var(--ink)]' : undefined}
          >
            <span className="tabular-nums">{b.labelled}/{b.total}</span>
            {' · '}
            <span className="font-medium">{b.name}</span>
            {' · '}
            {SELECTION_LABEL[b.selection]}
            {' · '}
            <span className={b.evalEligible ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>
              {b.evalEligible ? 'scoreable' : 'training only'}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
