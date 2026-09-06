'use client';

/**
 * One application, all its questions.
 *
 * The unit is the application, not the question: nobody answers "question 7 of
 * 43". You sit with one company's form and work through it, so this is the
 * shape that matches the task.
 *
 * Resume evidence sits beside the answer box - compressed facts from six CV
 * versions, filterable, one click to append. It is reference material, never a
 * draft: the point of the whole library is that Tim's own words come back,
 * not that something rewrites them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

interface Previous { company: string; answer: string; similarity?: number }
interface Question {
  id: string; question: string; kind: string;
  lengthLimit?: string; answer?: string; options?: string[]; previous: Previous[];
}
interface Evidence { id: string; content: string; date: string; track: string }
interface Highlight { sentence: string; matched: string[] }
interface Neighbour { company: string; similarity: number }
interface Role {
  title?: string; location?: string; url?: string; blurb?: string;
  salary?: string; remote?: string; onsiteDays?: string;
}

export default function ApplicationPage() {
  const { slug } = useParams<{ slug: string }>();
  const [company, setCompany] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [neighbours, setNeighbours] = useState<Neighbour[]>([]);
  const [role, setRole] = useState<Role | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [evidenceFilter, setEvidenceFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch(`/api/applications/${slug}`);
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json();
    setCompany(data.company);
    setQuestions(data.questions ?? []);
    setEvidence(data.evidence ?? []);
    setHighlights(data.highlights ?? []);
    setNeighbours(data.neighbours ?? []);
    setRole(data.role ?? null);
    setDrafts(Object.fromEntries((data.questions ?? []).map((q: Question) => [q.id, q.answer ?? ''])));
    setLoading(false);
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  const save = async (id: string) => {
    setSaving(id);
    await fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 'tim' because he typed it. A draft he approves unedited stays 'claude':
      // approval is not authorship.
      body: JSON.stringify({ id, answer: drafts[id] ?? '', provenance: 'tim' }),
    });
    setSaving(null);
    await load();
  };

  const shownEvidence = useMemo(() => {
    const q = evidenceFilter.trim().toLowerCase();
    if (!q) return evidence.slice(0, 8);
    return evidence.filter(e => e.content.toLowerCase().includes(q)).slice(0, 12);
  }, [evidence, evidenceFilter]);

  const done = questions.filter(q => q.answer).length;

  if (loading) return <main className="p-8 text-[var(--ink-muted)]">Loading…</main>;
  if (!questions.length) return <main className="p-8">No questions filed for this application.</main>;

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{company}</h1>
        {role?.title && (
          <p className="text-[var(--ink-muted)]">
            {role.url ? (
              <a href={role.url} target="_blank" rel="noopener noreferrer" className="underline">
                {role.title}
              </a>
            ) : role.title}
            {role.location ? ` · ${role.location}` : ''}
          </p>
        )}
        {/* What the posting states, so the salary and logistics answers are not
            written blind. Absent when the posting does not say - which is most
            of the time for salary, and worth showing as absence rather than
            filling in with a guess. */}
        {role && (role.salary || role.remote || role.onsiteDays) && (
          <p className="mt-1 flex flex-wrap gap-2 text-sm">
            {role.salary && (
              <span className="rounded bg-[var(--success-light)] px-2 py-0.5 text-[var(--success)]">
                {role.salary}
              </span>
            )}
            {role.onsiteDays && (
              <span className="rounded bg-[var(--warning-light)] px-2 py-0.5 text-[var(--warning)]">
                {role.onsiteDays} in office
              </span>
            )}
            {role.remote && !role.onsiteDays && (
              <span className="rounded bg-[var(--cream-dark)] px-2 py-0.5 text-[var(--ink-muted)]">
                {role.remote}
              </span>
            )}
          </p>
        )}
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          {done} of {questions.length} answered
        </p>
        {role?.blurb && (
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-[var(--ink-muted)]">
              What they say about themselves
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-sm">{role.blurb}</p>
          </details>
        )}
      </header>

      {(highlights.length > 0 || neighbours.length > 0) && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--cream-dark)] p-4">
          {highlights.length > 0 && (
            <>
              <h2 className="text-sm font-semibold">In this posting, things you tend to respond to</h2>
              <ul className="mt-2 space-y-2">
                {highlights.map((h, i) => (
                  <li key={i} className="text-sm">
                    <span className="italic">&ldquo;{h.sentence}&rdquo;</span>
                    <span className="ml-2 text-xs text-[var(--ink-muted)]">
                      {h.matched.join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {neighbours.length > 0 && (
            <p className="mt-3 text-xs text-[var(--ink-muted)]">
              Closest companies you have written for:{' '}
              {neighbours.map(n => `${n.company} (${Math.round(n.similarity * 100)}%)`).join(', ')}
            </p>
          )}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section className="space-y-4">
          {questions.map(q => (
            <article key={q.id} className="rounded-lg border border-[var(--border)] p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium">{q.question}</p>
                {q.lengthLimit && (
                  <span className="shrink-0 text-xs text-[var(--warning)]">{q.lengthLimit}</span>
                )}
              </div>

              {q.previous.map((p, i) => (
                <div key={i} className="mt-2 rounded border-l-2 border-[var(--accent)] bg-[var(--cream-dark)] p-2 text-sm">
                  <div className="mb-1 text-xs text-[var(--ink-muted)]">
                    what you wrote for {p.company}
                    {p.similarity !== undefined && p.similarity > 0.05 && (
                      <span className="ml-1">· {Math.round(p.similarity * 100)}% similar company</span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap">{p.answer}</p>
                  <button onClick={() => setDrafts(d => ({ ...d, [q.id]: p.answer }))}
                    className="mt-1 text-xs underline">reuse</button>
                </div>
              ))}

              {/* A Yes/No field answered by typing prose is silly. Where the
                  form offered choices, offer the same choices - and still allow
                  free text underneath, since some of these want a note. */}
              {q.options && q.options.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {q.options.map(o => (
                    <button
                      key={o}
                      onClick={() => setDrafts(d => ({ ...d, [q.id]: o }))}
                      className={
                        (drafts[q.id] ?? '') === o
                          ? 'rounded-full border border-[var(--accent)] bg-[var(--accent)] px-3 py-1 text-sm text-[var(--cream)]'
                          : 'rounded-full border border-[var(--border)] px-3 py-1 text-sm hover:border-[var(--accent)]'
                      }
                    >
                      {o}
                    </button>
                  ))}
                </div>
              )}

              <textarea
                value={drafts[q.id] ?? ''}
                onChange={e => setDrafts(d => ({ ...d, [q.id]: e.target.value }))}
                placeholder={q.options?.length ? 'Or write something' : 'Your answer'}
                className={
                  'mt-2 w-full resize-y rounded border border-[var(--border)] bg-[var(--cream)] p-2 text-sm ' +
                  (q.options?.length ? 'h-16' : 'h-28')
                }
              />
              <div className="mt-2 flex items-center gap-3">
                <button onClick={() => void save(q.id)}
                  disabled={saving === q.id || !(drafts[q.id] ?? '').trim()}
                  className="rounded-md bg-[var(--success)] px-3 py-1 text-sm font-medium text-[var(--cream)] disabled:opacity-40">
                  Save
                </button>
                {q.answer && drafts[q.id] === q.answer && (
                  <span className="text-xs text-[var(--ink-muted)]">saved</span>
                )}
              </div>
            </article>
          ))}
        </section>

        {/* Sticky and independently scrollable: the evidence list is longer
            than most forms, and scrolling the page to reach a bullet loses
            sight of the answer box it is meant to feed. */}
        <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
          <h2 className="text-sm font-semibold">Your evidence</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            From six CV versions. Click to append to the answer you last edited.
          </p>
          <input
            value={evidenceFilter}
            onChange={e => setEvidenceFilter(e.target.value)}
            placeholder="filter — pytorch, wire, encryption…"
            className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--cream)] px-2 py-1 text-sm"
          />
          <ul className="mt-2 space-y-2 pb-4">
            {shownEvidence.map(e => (
              <li key={e.id}>
                <button
                  onClick={() => {
                    const target = questions.find(q => (drafts[q.id] ?? '') !== (q.answer ?? '')) ?? questions[0];
                    setDrafts(d => ({
                      ...d,
                      [target.id]: `${d[target.id] ?? ''}${d[target.id] ? '\n' : ''}${e.content}`,
                    }));
                  }}
                  className="w-full rounded border border-[var(--border)] p-2 text-left text-xs hover:border-[var(--accent)]"
                >
                  <span className="text-[var(--ink-muted)]">{e.date} · {e.track}</span>
                  <span className="mt-1 block">{e.content}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </main>
  );
}
