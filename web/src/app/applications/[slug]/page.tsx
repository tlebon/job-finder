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
  lengthLimit?: string; answer?: string; previous: Previous[];
}
interface Evidence { id: string; content: string; date: string; track: string }
interface Highlight { sentence: string; matched: string[] }
interface Neighbour { company: string; similarity: number }

export default function ApplicationPage() {
  const { slug } = useParams<{ slug: string }>();
  const [company, setCompany] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [neighbours, setNeighbours] = useState<Neighbour[]>([]);
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
        <p className="text-sm text-[var(--ink-muted)]">
          {done} of {questions.length} answered
        </p>
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

              <textarea
                value={drafts[q.id] ?? ''}
                onChange={e => setDrafts(d => ({ ...d, [q.id]: e.target.value }))}
                placeholder="Your answer"
                className="mt-2 h-28 w-full resize-y rounded border border-[var(--border)] bg-[var(--cream)] p-2 text-sm"
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

        <aside className="lg:sticky lg:top-4 lg:self-start">
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
          <ul className="mt-2 space-y-2">
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
