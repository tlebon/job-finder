'use client';

/**
 * Blind labelling, and triage.
 *
 * Two populations share this UI. Rows drawn from the pre-gate sample are a
 * measurement, and must stay blind. Rows drawn from the live candidate list are
 * triage: a yes there moves the job to APPROVED, so a pass through 300 of them
 * builds a shortlist rather than only a training set.
 *
 * One question, asked the same way every time: would you open this and consider
 * applying? No score, no AI verdict, no source, no indication of whether the
 * regex kept it - this set is the only unbiased measurement in the project and
 * showing any of that would contaminate it.
 *
 * Keyboard-first because the value of this set comes from its size, and 300
 * decisions at fifteen seconds each only stays cheap if nobody reaches for a
 * mouse. The previous item stays undoable: a misfire that cannot be corrected
 * is worse than a slower pass.
 */

import { useCallback, useEffect, useState } from 'react';

interface Item {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
}

export default function LabelPage() {
  const [queue, setQueue] = useState<Item[]>([]);
  const [progress, setProgress] = useState({ total: 0, labelled: 0 });
  const [shortlisted, setShortlisted] = useState(0);
  const [history, setHistory] = useState<{ item: Item; label: number | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/label');
    const data = await res.json();
    setQueue(data.items);
    setProgress(data.progress);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const current = queue[0];

  const send = useCallback(async (id: string, label: number | null) => {
    const res = await fetch('/api/label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, label }),
    });
    return res.json() as Promise<{ shortlisted?: boolean }>;
  }, []);

  const decide = useCallback(async (label: number | null) => {
    if (!current || saving) return;
    setSaving(true);
    setHistory(h => [{ item: current, label }, ...h].slice(0, 20));
    setQueue(q => q.slice(1));
    setProgress(p => ({ ...p, labelled: p.labelled + (label === null ? 0 : 1) }));
    const res = await send(current.id, label);
    if (res?.shortlisted) setShortlisted(n => n + 1);
    setSaving(false);
    if (queue.length <= 3) void load();
  }, [current, saving, queue.length, send, load]);

  const undo = useCallback(async () => {
    const [last, ...rest] = history;
    if (!last) return;
    setHistory(rest);
    setQueue(q => [last.item, ...q]);
    setProgress(p => ({ ...p, labelled: Math.max(0, p.labelled - (last.label === null ? 0 : 1)) }));
    await send(last.item.id, null);
  }, [history, send]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'y' || k === 'j' || k === 'arrowright') { e.preventDefault(); void decide(1); }
      else if (k === 'n' || k === 'f' || k === 'arrowleft') { e.preventDefault(); void decide(0); }
      else if (k === 's') { e.preventDefault(); void decide(null); }
      else if (k === 'u' || k === 'backspace') { e.preventDefault(); void undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decide, undo]);

  const pct = progress.total ? Math.round((progress.labelled / progress.total) * 100) : 0;

  if (loading) return <main className="p-8 text-[var(--ink-muted)]">Loading…</main>;

  if (!current) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-semibold">Nothing left to label</h1>
        <p className="mt-3 text-[var(--ink-muted)]">
          {progress.labelled} of {progress.total} done. Run
          {' '}<code className="rounded bg-[var(--cream-dark)] px-1.5 py-0.5 font-mono text-sm">npx tsx src/eval-gate-vs-human.ts</code>{' '}
          to score the gate against these.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col p-4 sm:p-6">
      <header className="mb-4">
        <div className="flex items-baseline justify-between text-sm text-[var(--ink-muted)]">
          <span>Would you open this and consider applying?</span>
          <span className="tabular-nums">
            {shortlisted > 0 && (
              <span className="mr-3 text-[var(--success)]">{shortlisted} shortlisted</span>
            )}
            {progress.labelled} / {progress.total} · {pct}%
          </span>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded bg-[var(--border)]">
          <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${pct}%` }} />
        </div>
      </header>

      <article className="flex-1 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--cream)] p-4 sm:p-6">
        <h1 className="text-xl font-semibold sm:text-2xl">{current.title}</h1>
        <p className="mt-1 text-[var(--ink-muted)]">
          {current.company} · {current.location}
        </p>
        {current.description.length < 800 && (
          /* Adzuna's API returns a hard 500-character blurb and nothing more -
             27% of the corpus. The gate and the AI reviewer judge these on the
             same fragment, so they stay in the sample rather than being quietly
             dropped, but you should know when you are deciding on a summary.
             Skip is the right answer when the fragment does not tell you. */
          <p className="mt-4 rounded border border-[var(--accent)]/30 bg-[var(--warning-light)] px-3 py-2 text-sm text-[var(--warning)]">
            Short listing - this is everything the source provides, usually the
            first 500 characters. Press <strong>s</strong> to skip if you cannot
            judge it; skipped items are excluded rather than counted as no.
          </p>
        )}
        <pre className="mt-5 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
          {current.description.slice(0, 6000)}
        </pre>
      </article>

      <footer className="mt-4 flex flex-wrap items-center gap-2">
        <button onClick={() => void decide(1)} disabled={saving}
          className="rounded-md bg-[var(--success)] px-4 py-2 font-medium text-[var(--cream)] disabled:opacity-50">
          Yes <span className="opacity-70">(y)</span>
        </button>
        <button onClick={() => void decide(0)} disabled={saving}
          className="rounded-md bg-[#9F1239] px-4 py-2 font-medium text-[var(--cream)] disabled:opacity-50">
          No <span className="opacity-70">(n)</span>
        </button>
        <button onClick={() => void decide(null)} disabled={saving}
          className="rounded-md border border-[var(--border)] bg-[var(--cream-dark)] px-4 py-2">
          Skip <span className="opacity-70">(s)</span>
        </button>
        <button onClick={() => void undo()} disabled={!history.length}
          className="ml-auto rounded-md border border-[var(--border)] px-4 py-2 disabled:opacity-40">
          Undo <span className="opacity-70">(u)</span>
        </button>
      </footer>
    </main>
  );
}
