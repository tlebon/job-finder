'use client';

/**
 * The application question bank.
 *
 * Built from six real forms. Of roughly 35 fields across them, only about six
 * were novel prose - the rest were mechanical, or recurring with "Why
 * [company]?" appearing in four of six. So this stores what is expensive to
 * reproduce, and gets out of the way for everything else.
 *
 * Retrieval-first: it shows what Tim wrote before rather than drafting over it.
 * The whole point is that his words come back, not that they get rewritten.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Question {
  id: string;
  question: string;
  kind: 'prose' | 'decision' | 'mechanical';
  company?: string;
  ats?: string;
  lengthLimit?: string;
  answer?: string;
  provenance?: string;
  timesUsed: number;
}

interface JobOption {
  id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  suggestion?: string;
  reach?: string;
}

interface ParsedField {
  question: string;
  kind: Question['kind'];
  required: boolean;
  lengthLimit?: string;
}

const KIND_LABEL: Record<string, string> = {
  prose: 'Writing',
  decision: 'Decision',
  mechanical: 'Mechanical',
};

export default function QuestionsPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [paste, setPaste] = useState('');
  const [parsed, setParsed] = useState<ParsedField[] | null>(null);
  const [ats, setAts] = useState<string>();
  const [company, setCompany] = useState('');
  // The job a pasted form belongs to. Without it a question is just text; with
  // it, prior answers can be found by how similar the company is rather than by
  // who happened to phrase the question the same way.
  const [jobQuery, setJobQuery] = useState('');
  const [jobOptions, setJobOptions] = useState<JobOption[]>([]);
  const [job, setJob] = useState<JobOption | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch('/api/questions');
    const data = await res.json();
    setQuestions(data.questions ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (job || jobQuery.trim().length < 2) { setJobOptions([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/questions/jobs?q=${encodeURIComponent(jobQuery)}`);
      const data = await res.json();
      setJobOptions(data.jobs ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [jobQuery, job]);

  const parse = async () => {
    const res = await fetch('/api/questions/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: paste }),
    });
    const data = await res.json();
    setParsed(data.fields ?? []);
    setAts(data.ats);
  };

  const commitForm = async () => {
    if (!parsed) return;
    await fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: parsed,
        company: job?.company ?? (company || undefined),
        jobId: job?.id,
        ats,
      }),
    });
    setParsed(null);
    setPaste('');
    setCompany('');
    setJob(null);
    setJobQuery('');
    await load();
  };

  const saveAnswer = async (id: string) => {
    setSaving(id);
    await fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 'tim' because he typed it. A Claude draft he approves without editing
      // stays 'claude' - approval is not authorship, and blurring the two is
      // how the bank quietly fills with a voice that is not his.
      body: JSON.stringify({ id, answer: drafts[id] ?? '', provenance: 'tim' }),
    });
    setSaving(null);
    await load();
  };

  const unanswered = useMemo(() => questions.filter(q => !q.answer), [questions]);
  const answered = useMemo(() => questions.filter(q => q.answer), [questions]);

  /** Previous answers to the same question, so the past is visible while writing. */
  const previous = (q: Question) =>
    answered.filter(a => a.id !== q.id &&
      a.question.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) ===
      q.question.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24));

  if (loading) return <main className="p-8 text-[var(--ink-muted)]">Loading…</main>;

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Application questions</h1>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        Paste a form, keep what costs you something to write, and reuse it next time.
      </p>

      {/* ---- paste a form ---- */}
      <section className="mt-6 rounded-lg border border-[var(--border)] p-4">
        <textarea
          value={paste}
          onChange={e => setPaste(e.target.value)}
          placeholder="Paste the whole application form here — quirks and all."
          className="h-32 w-full resize-y rounded border border-[var(--border)] bg-[var(--cream)] p-3 text-sm"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {job ? (
            <span className="flex items-center gap-2 rounded border border-[var(--accent)] bg-[var(--cream-dark)] px-3 py-1.5 text-sm">
              {job.company} — {job.title.slice(0, 40)}
              <button onClick={() => { setJob(null); setJobQuery(''); }}
                className="text-[var(--ink-muted)]" aria-label="clear">×</button>
            </span>
          ) : (
            <div className="relative">
              <input
                value={jobQuery}
                onChange={e => setJobQuery(e.target.value)}
                placeholder="Which job is this for?"
                className="rounded border border-[var(--border)] bg-[var(--cream)] px-3 py-1.5 text-sm"
              />
              {jobOptions.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-56 w-80 overflow-auto rounded border border-[var(--border)] bg-[var(--cream)] shadow">
                  {jobOptions.map(o => (
                    <li key={o.id}>
                      <button onClick={() => { setJob(o); setJobOptions([]); }}
                        className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--cream-dark)]">
                        <span className="font-medium">{o.company}</span> — {o.title.slice(0, 44)}
                        <span className="ml-1 text-xs text-[var(--ink-muted)]">
                          {o.suggestion === 'STRONG_FIT' ? 'strong' : ''} {o.reach ?? ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <input
            value={company}
            onChange={e => setCompany(e.target.value)}
            placeholder={job ? 'Company (from job)' : 'Company (if not listed)'}
            disabled={!!job}
            className="rounded border border-[var(--border)] bg-[var(--cream)] px-3 py-1.5 text-sm disabled:opacity-40"
          />
          <button onClick={() => void parse()} disabled={paste.trim().length < 10}
            className="rounded-md bg-[var(--accent)] px-4 py-1.5 font-medium text-[var(--cream)] disabled:opacity-40">
            Split into questions
          </button>
          {ats && <span className="text-sm text-[var(--ink-muted)]">detected: {ats}</span>}
        </div>

        {parsed && (
          <div className="mt-4">
            <p className="text-sm text-[var(--ink-muted)]">
              {parsed.filter(f => f.kind !== 'mechanical').length} worth keeping,
              {' '}{parsed.filter(f => f.kind === 'mechanical').length} mechanical.
              Remove anything that is not a question.
            </p>
            <ul className="mt-2 space-y-1">
              {parsed.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <button
                    onClick={() => setParsed(parsed.filter((_, j) => j !== i))}
                    className="mt-0.5 text-[var(--ink-muted)] hover:text-[var(--warning)]"
                    aria-label="remove"
                  >×</button>
                  <span className={f.kind === 'mechanical' ? 'text-[var(--ink-muted)]' : ''}>
                    <span className="mr-2 rounded bg-[var(--cream-dark)] px-1.5 py-0.5 text-xs">
                      {KIND_LABEL[f.kind]}
                    </span>
                    {f.question}
                    {f.lengthLimit && <em className="ml-2 text-[var(--warning)]">{f.lengthLimit}</em>}
                  </span>
                </li>
              ))}
            </ul>
            <button onClick={() => void commitForm()}
              className="mt-3 rounded-md bg-[var(--success)] px-4 py-1.5 font-medium text-[var(--cream)]">
              Save {parsed.length} fields
            </button>
          </div>
        )}
      </section>

      {/* ---- questions still needing an answer ---- */}
      {unanswered.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Needs an answer ({unanswered.length})</h2>
          {unanswered.map(q => (
            <article key={q.id} className="mt-3 rounded-lg border border-[var(--border)] p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium">{q.question}</p>
                <span className="shrink-0 text-xs text-[var(--ink-muted)]">
                  {q.company ?? ''} {q.lengthLimit ? `· ${q.lengthLimit}` : ''}
                </span>
              </div>

              {previous(q).map(p => (
                <div key={p.id} className="mt-2 rounded border-l-2 border-[var(--accent)] bg-[var(--cream-dark)] p-2 text-sm">
                  <div className="mb-1 text-xs text-[var(--ink-muted)]">
                    you wrote this for {p.company ?? 'another application'}
                  </div>
                  <p className="whitespace-pre-wrap">{p.answer}</p>
                  <button onClick={() => setDrafts(d => ({ ...d, [q.id]: p.answer ?? '' }))}
                    className="mt-1 text-xs underline">reuse</button>
                </div>
              ))}

              <textarea
                value={drafts[q.id] ?? ''}
                onChange={e => setDrafts(d => ({ ...d, [q.id]: e.target.value }))}
                placeholder="Your answer"
                className="mt-2 h-24 w-full resize-y rounded border border-[var(--border)] bg-[var(--cream)] p-2 text-sm"
              />
              <button onClick={() => void saveAnswer(q.id)}
                disabled={saving === q.id || !(drafts[q.id] ?? '').trim()}
                className="mt-2 rounded-md bg-[var(--success)] px-3 py-1 text-sm font-medium text-[var(--cream)] disabled:opacity-40">
                Save
              </button>
            </article>
          ))}
        </section>
      )}

      {/* ---- the bank ---- */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Answered ({answered.length})</h2>
        {answered.length === 0 && (
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Nothing yet. Paste a form above to start.
          </p>
        )}
        {answered.map(q => (
          <article key={q.id} className="mt-3 rounded-lg border border-[var(--border)] p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-medium">{q.question}</p>
              <span className="shrink-0 text-xs text-[var(--ink-muted)]">
                {q.timesUsed > 0 ? `used ${q.timesUsed}×` : ''} {q.company ?? ''}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm">{q.answer}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
