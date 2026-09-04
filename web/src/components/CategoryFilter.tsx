'use client';

/**
 * Category filter chips.
 *
 * The vocabulary comes from the scraper's techCategories, so scoring and
 * filtering share one list rather than drifting apart. A job's categories are
 * computed at filter time and stored, so this is a straight array lookup.
 */

export const CATEGORY_LABELS: Record<string, string> = {
  ml: 'ML',
  llm: 'LLM / AI',
  data: 'Data',
  frontend: 'Frontend',
  backend: 'Backend',
  infra: 'Infra',
  web3: 'Web3',
  privacy: 'Privacy',
};

/** Ordered so the roles Tim is targeting sit first. */
export const CATEGORY_ORDER = ['ml', 'llm', 'data', 'frontend', 'backend', 'infra', 'privacy', 'web3'];

const CATEGORY_STYLES: Record<string, string> = {
  ml: 'bg-violet-50 text-violet-700 border-violet-200',
  llm: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  data: 'bg-sky-50 text-sky-700 border-sky-200',
  frontend: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  backend: 'bg-teal-50 text-teal-700 border-teal-200',
  infra: 'bg-slate-50 text-slate-700 border-slate-200',
  web3: 'bg-amber-50 text-amber-700 border-amber-200',
  privacy: 'bg-rose-50 text-rose-700 border-rose-200',
};

export function categoryChipClass(category: string): string {
  return CATEGORY_STYLES[category] || 'bg-gray-50 text-gray-600 border-gray-200';
}

interface Props {
  /** Category -> number of jobs currently carrying it. */
  counts: Record<string, number>;
  active: Set<string>;
  onToggle: (category: string) => void;
  onClear: () => void;
  /** Jobs needing relocation, for the extra toggle. */
  relocationCount?: number;
  hideRelocation?: boolean;
  onToggleRelocation?: () => void;
}

export function CategoryFilter({
  counts,
  active,
  onToggle,
  onClear,
  relocationCount = 0,
  hideRelocation = false,
  onToggleRelocation,
}: Props) {
  const present = CATEGORY_ORDER.filter(c => (counts[c] || 0) > 0);
  if (present.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <span className="text-xs uppercase tracking-wider text-[var(--ink-muted)] mr-1">Filter</span>

      {present.map(cat => {
        const isActive = active.has(cat);
        return (
          <button
            key={cat}
            onClick={() => onToggle(cat)}
            className={`px-3 py-1.5 min-h-[36px] rounded-full text-xs font-medium border transition-all ${
              isActive
                ? 'bg-[var(--ink)] text-[var(--cream)] border-[var(--ink)]'
                : categoryChipClass(cat) + ' hover:opacity-80'
            }`}
          >
            {CATEGORY_LABELS[cat] || cat}
            <span className={`ml-1.5 ${isActive ? 'opacity-70' : 'opacity-60'}`}>{counts[cat]}</span>
          </button>
        );
      })}

      {relocationCount > 0 && onToggleRelocation && (
        <button
          onClick={onToggleRelocation}
          className={`px-3 py-1.5 min-h-[36px] rounded-full text-xs font-medium border transition-all ${
            hideRelocation
              ? 'bg-[var(--ink)] text-[var(--cream)] border-[var(--ink)]'
              : 'bg-white text-[var(--ink-muted)] border-[var(--border)] hover:opacity-80'
          }`}
          title="Roles that are US on-site with no remote option"
        >
          {hideRelocation ? 'Relocation hidden' : 'Needs relocation'}
          <span className="ml-1.5 opacity-60">{relocationCount}</span>
        </button>
      )}

      {(active.size > 0 || hideRelocation) && (
        <button
          onClick={onClear}
          className="px-3 py-1.5 min-h-[36px] text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}
