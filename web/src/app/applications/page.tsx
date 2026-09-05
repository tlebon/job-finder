'use client';

/** Applications with questions filed against them, unfinished ones first. */

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Application {
  slug: string; company: string; total: number; answered: number; ats?: string;
}

export default function ApplicationsPage() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/applications');
      const data = await res.json();
      setApps(data.applications ?? []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <main className="p-8 text-[var(--ink-muted)]">Loading…</main>;

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Applications</h1>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        Questions grouped by the company that asked them.
      </p>

      {apps.length === 0 && (
        <p className="mt-6 text-sm text-[var(--ink-muted)]">
          Nothing filed yet. Paste a form at <Link href="/questions" className="underline">/questions</Link>.
        </p>
      )}

      <ul className="mt-6 space-y-2">
        {apps.map(a => (
          <li key={a.slug}>
            <Link href={`/applications/${a.slug}`}
              className="flex items-baseline justify-between rounded-lg border border-[var(--border)] p-4 hover:border-[var(--accent)]">
              <span className="font-medium">{a.company}</span>
              <span className="text-sm text-[var(--ink-muted)] tabular-nums">
                {a.answered} / {a.total}
                {a.answered < a.total && <span className="ml-2 text-[var(--accent)]">to do</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
