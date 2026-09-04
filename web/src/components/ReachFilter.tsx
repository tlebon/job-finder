'use client';

/**
 * Filter by how far a reach a job is.
 *
 * The reviewer answers two questions independently: how much Tim wants a job,
 * and whether it is realistic, a stretch, or a moonshot. Collapsed into one
 * verdict those were indistinguishable - a long shot at a frontier lab and a
 * mediocre match both landed on MAYBE.
 *
 * Kept separate, the useful band becomes visible: roles he would want where he
 * is a credible but not obvious candidate. Moonshots stay reachable on purpose,
 * because a few a month is a deliberate choice rather than an accident.
 */

export type Reach = 'realistic' | 'stretch' | 'moonshot';

export const REACH_ORDER: Reach[] = ['realistic', 'stretch', 'moonshot'];

export const REACH_LABELS: Record<Reach, string> = {
  realistic: 'Realistic',
  stretch: 'Stretch',
  moonshot: 'Moonshot',
};

const REACH_HINT: Record<Reach, string> = {
  realistic: 'Your background clears the stated bar',
  stretch: 'Credible but not the obvious candidate',
  moonshot: 'A long shot - spend these deliberately',
};

export function reachChipClass(reach: Reach, active: boolean): string {
  const base = 'rounded-full border px-3 py-1 text-sm transition-colors';
  if (!active) return `${base} border-[var(--border)] text-[var(--ink-muted)] hover:border-[var(--accent)]`;
  return {
    realistic: `${base} border-[var(--success)] bg-[var(--success)] text-[var(--cream)]`,
    stretch: `${base} border-[var(--accent)] bg-[var(--accent)] text-[var(--cream)]`,
    moonshot: `${base} border-[var(--warning)] bg-[var(--warning-light)] text-[var(--warning)]`,
  }[reach];
}

interface Props {
  active: Set<Reach>;
  counts: Record<string, number>;
  onToggle: (reach: Reach) => void;
}

export function ReachFilter({ active, counts, onToggle }: Props) {
  const present = REACH_ORDER.filter(r => (counts[r] ?? 0) > 0);
  if (!present.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-[var(--ink-muted)]">Reach:</span>
      {present.map(reach => (
        <button
          key={reach}
          onClick={() => onToggle(reach)}
          title={REACH_HINT[reach]}
          className={reachChipClass(reach, active.has(reach))}
        >
          {REACH_LABELS[reach]}
          <span className="ml-1.5 opacity-70 tabular-nums">{counts[reach] ?? 0}</span>
        </button>
      ))}
      {counts.unrated > 0 && (
        <span className="text-sm text-[var(--ink-muted)]">
          {counts.unrated} not yet rated
        </span>
      )}
    </div>
  );
}
