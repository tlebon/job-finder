'use client';

/**
 * Where the job is, as something to filter on.
 *
 * "Needs relocation" is a single flag and too blunt: it lumps a Munich role in
 * with San Francisco, when one is a train ride and the other is a continent and
 * a visa. Tim lives in Berlin, so the distinction that matters most is whether
 * he could take the job without moving at all.
 */

export type Place = 'berlin' | 'germany' | 'europe' | 'remote' | 'elsewhere';

export const PLACE_ORDER: Place[] = ['berlin', 'germany', 'remote', 'europe', 'elsewhere'];

export const PLACE_LABELS: Record<Place, string> = {
  berlin: 'Berlin',
  germany: 'Germany',
  remote: 'Remote',
  europe: 'Europe',
  elsewhere: 'Further afield',
};

const PATTERNS: [Place, RegExp][] = [
  ['berlin', /\bberlin\b/i],
  ['germany', /\b(germany|deutschland|münchen|munich|hamburg|frankfurt|köln|cologne|stuttgart|leipzig|dresden|nürnberg|düsseldorf)\b/i],
  ['remote', /\b(remote|anywhere|distributed|home office)\b/i],
  ['europe', /\b(netherlands|amsterdam|france|paris|spain|madrid|barcelona|portugal|lisbon|ireland|dublin|sweden|stockholm|denmark|copenhagen|norway|oslo|finland|helsinki|switzerland|zurich|zürich|geneva|austria|vienna|poland|warsaw|czech|prague|belgium|brussels|italy|milan|rome|united kingdom|london|england|scotland|europe|emea)\b/i],
];

/**
 * Most specific first, so "Remote - Berlin" is Berlin rather than merely remote
 * and a Munich role is Germany rather than generic Europe.
 */
export function placeOf(location: string | undefined): Place {
  const text = location ?? '';
  for (const [place, pattern] of PATTERNS) {
    if (pattern.test(text)) return place;
  }
  return 'elsewhere';
}

export function placeChipClass(active: boolean): string {
  const base = 'rounded-full border px-3 py-1 text-sm transition-colors';
  return active
    ? `${base} border-[var(--accent)] bg-[var(--accent)] text-[var(--cream)]`
    : `${base} border-[var(--border)] text-[var(--ink-muted)] hover:border-[var(--accent)]`;
}

interface Props {
  active: Set<Place>;
  counts: Record<string, number>;
  onToggle: (place: Place) => void;
}

export function LocationFilter({ active, counts, onToggle }: Props) {
  const present = PLACE_ORDER.filter(p => (counts[p] ?? 0) > 0);
  if (!present.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-[var(--ink-muted)]">Where:</span>
      {present.map(place => (
        <button key={place} onClick={() => onToggle(place)} className={placeChipClass(active.has(place))}>
          {PLACE_LABELS[place]}
          <span className="ml-1.5 opacity-70 tabular-nums">{counts[place] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}
