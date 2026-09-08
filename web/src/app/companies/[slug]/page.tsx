'use client';

/**
 * Every live role at one company.
 *
 * The view that answers "what else is open here" - after applying to one role,
 * or after a company turns out to be interesting. It reports what you have
 * already applied to rather than hiding the rest: applying to several teams at
 * Anthropic is normal, and doing the same at a company of twelve is not, and
 * only Tim knows which case he is in.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Job {
  id: string; title: string; location: string; url: string; status: string;
  suggestion?: string; reach?: string; modelScore?: number; dateFound: string;
}

export default function CompanyPage() {
  const { slug } = useParams<{ slug: string }>();
  const [company, setCompany] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applied, setApplied] = useState<{ id: string; title: string }[]>([]);
  const [dismissed, setDismissed] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch(`/api/companies/${slug}`);
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json();
    setCompany(data.company);
    setJobs(data.jobs ?? []);
    setApplied(data.applied ?? []);
    setDismissed(data.dismissed ?? 0);
    setLoading(false);
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <main className="p-8 text-[var(--ink-muted)]">Loading…</main>;
  if (!jobs.length && !applied.length) return <main className="p-8">Nothing open here.</main>;

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href="/companies" className="text-sm text-[var(--accent)] hover:underline">← Companies</Link>
      <h1 className="mt-2 text-2xl font-serif font-medium text-[var(--ink)]">{company}</h1>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        {jobs.length} open{dismissed > 0 ? ` · ${dismissed} dismissed` : ''}
      </p>

      {applied.length > 0 && (
        <div className="mt-3 rounded-lg border border-[var(--success)] bg-[var(--success-light)] p-3 text-sm text-[var(--success)]">
          You have applied here: {applied.map(a => a.title).join(', ')}.
          {' '}Whether a second application makes sense depends on the company —
          separate teams hiring separately, or one person reading all of them.
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {jobs.map(j => (
          <li key={j.id}
            className="rounded-lg border border-[var(--border)] p-3">
            <div className="flex items-baseline justify-between gap-3">
              <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">{j.title}</Link>
              <span className="shrink-0 text-xs text-[var(--ink-muted)]">
                {j.suggestion === 'STRONG_FIT' ? 'strong' : j.suggestion === 'GOOD_FIT' ? 'good' : ''}
                {j.reach ? ` · ${j.reach}` : ''}
                {j.status === 'APPLIED' ? ' · applied' : j.status === 'APPROVED' ? ' · shortlisted' : ''}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-[var(--ink-muted)]">{j.location}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
