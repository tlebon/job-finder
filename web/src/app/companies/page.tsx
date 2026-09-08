'use client';

/** Companies with live postings, most promising first. */

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Company {
  slug: string; company: string; total: number; strong: number;
  applied: number; approved: number;
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/companies');
      const data = await res.json();
      setCompanies(data.companies ?? []);
      setLoading(false);
    })();
  }, []);

  const shown = companies.filter(c => c.company.toLowerCase().includes(q.trim().toLowerCase()));

  if (loading) return <main className="p-8 text-[var(--ink-muted)]">Loading…</main>;

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      <Link href="/candidates" className="text-sm text-[var(--accent)] hover:underline">← Candidates</Link>
      <h1 className="mt-2 text-2xl font-serif font-medium text-[var(--ink)]">Companies</h1>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        {companies.length} with live postings
        {shown.length < companies.length && ` · ${shown.length} shown`}
      </p>
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="filter"
        className="mt-3 w-full rounded border border-[var(--border)] bg-[var(--cream)] px-3 py-1.5 text-sm"
      />
      <ul className="mt-4 space-y-2">
        {shown.map(c => (
          <li key={c.slug}>
            <Link href={`/companies/${c.slug}`}
              className="flex items-baseline justify-between rounded-lg border border-[var(--border)] p-3 hover:border-[var(--accent)]">
              <span className="font-medium">
                {c.company}
                {c.applied > 0 && (
                  <span className="ml-2 rounded bg-[var(--success-light)] px-1.5 py-0.5 text-xs text-[var(--success)]">
                    applied
                  </span>
                )}
              </span>
              <span className="text-sm text-[var(--ink-muted)] tabular-nums">
                {c.strong > 0 && <span className="text-[var(--accent)]">{c.strong} strong</span>}
                <span className="ml-2">{c.total} open</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
