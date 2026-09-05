/**
 * The application question bank.
 *
 * Scope came from reading six real forms across Greenhouse, Lever and Ashby.
 * Of roughly 35 fields, only about six were novel prose. The rest were either
 * mechanical - name, email, phone, which the browser already autofills - or
 * recurring: "Why [company]?" appeared in four of the six.
 *
 * So this stores what is expensive to reproduce, not what merely repeats.
 * Work authorisation is deliberately absent: Tim knows whether he can work
 * somewhere, and storing it would save two seconds and no thought. "How did
 * you hear about us?" is absent for a different reason - it is job-specific
 * and derivable from job.source, so it is answered rather than stored.
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from './db.js';
import { initChunkStore, normalizeQuestion, type Provenance } from './chunks.js';

/**
 * What a field costs to answer.
 *
 * 'prose' is why this exists. 'decision' is the handful of facts needing a
 * judgement rather than a lookup - salary, notice period, earliest start.
 * 'mechanical' is recorded so a pasted form stays intact, and never surfaced.
 */
export type QuestionKind = 'prose' | 'decision' | 'mechanical';

export type Ats = 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'other';

export interface Question {
  id: string;
  normalizedKey: string;
  questionText: string;
  kind: QuestionKind;
  company?: string;
  jobId?: string;
  ats?: Ats;
  lengthLimit?: string;
  answer?: string;
  provenance?: Provenance;
  lastConfirmed?: string;
  createdAt?: string;
  timesUsed?: number;
}

interface Row {
  id: string; normalized_key: string; question_text: string; kind: string;
  company: string | null; job_id: string | null; ats: string | null;
  length_limit: string | null; answer: string | null; provenance: string | null;
  last_confirmed: string | null; created_at: string | null; times_used?: number;
}

function toQuestion(r: Row): Question {
  return {
    id: r.id,
    normalizedKey: r.normalized_key,
    questionText: r.question_text,
    kind: (r.kind as QuestionKind) || 'prose',
    company: r.company ?? undefined,
    jobId: r.job_id ?? undefined,
    ats: (r.ats as Ats) ?? undefined,
    lengthLimit: r.length_limit ?? undefined,
    answer: r.answer ?? undefined,
    provenance: (r.provenance as Provenance) ?? undefined,
    lastConfirmed: r.last_confirmed ?? undefined,
    createdAt: r.created_at ?? undefined,
    timesUsed: r.times_used ?? 0,
  };
}

export function saveQuestion(q: Omit<Question, 'id' | 'normalizedKey'> & { id?: string }): string {
  initChunkStore();
  const id = q.id ?? uuidv4();

  db.prepare(`
    INSERT INTO application_questions
      (id, normalized_key, question_text, kind, company, job_id, ats,
       length_limit, answer, provenance, last_confirmed)
    VALUES (@id, @key, @text, @kind, @company, @jobId, @ats,
            @lengthLimit, @answer, @provenance, @lastConfirmed)
    ON CONFLICT(id) DO UPDATE SET
      question_text = @text, kind = @kind, company = @company, job_id = @jobId,
      ats = @ats, length_limit = @lengthLimit, answer = @answer,
      provenance = @provenance, last_confirmed = @lastConfirmed
  `).run({
    id,
    key: normalizeQuestion(q.questionText),
    text: q.questionText,
    kind: q.kind ?? 'prose',
    company: q.company ?? null,
    jobId: q.jobId ?? null,
    ats: q.ats ?? null,
    lengthLimit: q.lengthLimit ?? null,
    answer: q.answer ?? null,
    // Approval is not authorship. A Claude-drafted answer Tim approved is still
    // 'claude'; only editing it makes it 'tim_edited'. Same rule as the letter
    // chunks, and for the same reason - otherwise the bank fills with Claude's
    // voice and nobody notices.
    provenance: q.provenance ?? null,
    lastConfirmed: q.answer ? (q.lastConfirmed ?? new Date().toISOString()) : null,
  });

  return id;
}

/** Answered questions, most reused first - those are worth polishing. */
export function listAnswered(kind?: QuestionKind): Question[] {
  initChunkStore();
  const rows = db.prepare(`
    SELECT q.*, (SELECT COUNT(*) FROM answer_uses u WHERE u.question_id = q.id) times_used
    FROM application_questions q
    WHERE q.answer IS NOT NULL AND q.answer <> ''
      ${kind ? 'AND q.kind = ?' : ''}
    ORDER BY times_used DESC, q.created_at DESC
  `).all(...(kind ? [kind] : [])) as Row[];
  return rows.map(toQuestion);
}

/** Unanswered questions from pasted forms - the queue of what still needs writing. */
export function listUnanswered(): Question[] {
  initChunkStore();
  const rows = db.prepare(`
    SELECT * FROM application_questions
    WHERE (answer IS NULL OR answer = '') AND kind <> 'mechanical'
    ORDER BY created_at DESC
  `).all() as Row[];
  return rows.map(toQuestion);
}

/**
 * Previous answers to the same question.
 *
 * Exact normalised match only, for now. Paraphrase matching needs embeddings,
 * and until there is a corpus there is nothing to match against - at thirty or
 * a hundred questions a searchable list beats a similarity model and is honest
 * about what it is doing.
 */
export function findPrevious(questionText: string, excludeId?: string): Question[] {
  initChunkStore();
  const rows = db.prepare(`
    SELECT * FROM application_questions
    WHERE normalized_key = ? AND answer IS NOT NULL AND answer <> ''
      ${excludeId ? 'AND id <> ?' : ''}
    ORDER BY created_at DESC
  `).all(...(excludeId ? [normalizeQuestion(questionText), excludeId] : [normalizeQuestion(questionText)])) as Row[];
  return rows.map(toQuestion);
}

/** Record that an answer was used on an application. */
export function recordUse(questionId: string, jobId?: string, company?: string, edited = false): void {
  initChunkStore();
  db.prepare(`
    INSERT INTO answer_uses (id, question_id, job_id, company, edited)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), questionId, jobId ?? null, company ?? null, edited ? 1 : 0);
}

export function deleteQuestion(id: string): boolean {
  initChunkStore();
  return db.prepare('DELETE FROM application_questions WHERE id = ?').run(id).changes > 0;
}
