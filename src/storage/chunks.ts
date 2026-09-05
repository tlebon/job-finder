import { v4 as uuidv4 } from 'uuid';
import { db } from './db.js';

/**
 * Chunk library for cover letter assembly.
 *
 * Two corpora that must never mix:
 *   - voice   (provenance 'tim', pre-ChatGPT letters) governs HOW things are said
 *   - facts   (job-overview.md) governs WHAT is true
 *
 * Provenance is declared at ingestion, never inferred. Approval is not
 * authorship: a Claude-written chunk that Tim approved is still 'claude', and
 * serving it as a voice exemplar is how the voice drifts without anyone noticing.
 */

export type Provenance = 'tim' | 'tim_edited' | 'claude';
export type ChunkLevel = 'paragraph' | 'sentence';
export type RoleTrack = 'ic' | 'em' | 'both';

/** Structural position in a letter. Assembly fills each slot once, in order. */
export type Slot =
  | 'salutation'
  | 'opening'
  | 'career_background'
  | 'current_role'
  | 'domain_interest'
  | 'why_company'
  | 'logistics'
  | 'closing'
  // Not a letter slot. Resume bullets are compressed evidence rather than
  // argument - "943-dim embedding recommendation engine, sentence-transformers
  // + node2vec, k-NN, FastAPI" is the raw stock for "what is the best evidence
  // you would be great at this", not a sentence to drop into a letter. They are
  // reference material shown beside an answer, never assembled into one.
  | 'evidence';

export interface Chunk {
  id: string;
  level: ChunkLevel;
  parentId?: string;
  slot: Slot;
  content: string;
  provenance: Provenance;
  sourceLetter: string;
  sourceDate: string;
  roleTrack: RoleTrack;
  tags: string[];
  voiceEligible: boolean;
  timesUsed: number;
}

interface ChunkRow {
  id: string;
  level: string;
  parent_id: string | null;
  slot: string;
  content: string;
  provenance: string;
  source_letter: string;
  source_date: string;
  role_track: string;
  tags: string | null;
  voice_eligible: number;
  times_used: number;
}

let initialised = false;

export function initChunkStore(): void {
  if (initialised) return;

  // DEFAULT CURRENT_TIMESTAMP is fine in CREATE TABLE; SQLite only rejects it
  // in ALTER TABLE ADD COLUMN.
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      parent_id TEXT,
      slot TEXT NOT NULL,
      content TEXT NOT NULL,
      provenance TEXT NOT NULL,
      source_letter TEXT NOT NULL,
      source_date TEXT,
      role_track TEXT DEFAULT 'both',
      tags TEXT,
      voice_eligible INTEGER DEFAULT 0,
      times_used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chunks_slot ON chunks(slot);
    CREATE INDEX IF NOT EXISTS idx_chunks_provenance ON chunks(provenance);
    CREATE INDEX IF NOT EXISTS idx_chunks_voice ON chunks(voice_eligible);
  `);

  // Real questions from real applications, never invented ones.
  //
  // Scope came from reading six actual forms across Greenhouse, Lever and
  // Ashby. Of roughly 35 fields, only about six were novel prose - the rest
  // were either mechanical (name, email, phone, which the browser already
  // autofills) or recurring ("Why [company]?" appeared in four of six).
  //
  // So this stores what is expensive to reproduce, not what merely repeats.
  // Work authorisation is deliberately absent: Tim knows whether he can work
  // somewhere, and storing it saves two seconds and no thought.
  db.exec(`
    CREATE TABLE IF NOT EXISTS application_questions (
      id TEXT PRIMARY KEY,
      normalized_key TEXT NOT NULL,
      question_text TEXT NOT NULL,
      company TEXT,
      job_id TEXT,
      answer TEXT,
      provenance TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  for (const column of [
    // 'prose' is the reason this exists. 'decision' covers the few facts that
    // need a judgement rather than a lookup - salary, notice period, earliest
    // start. 'mechanical' is recorded but never worth surfacing.
    "kind TEXT DEFAULT 'prose'",
    // Greenhouse, Lever, Ashby. Form structure belongs to the platform rather
    // than the company, so a parsing rule learned once generalises.
    'ats TEXT',
    // "in 5 sentences or less", "in just one line". The same answer needs
    // different lengths, so the constraint belongs on the use, not the answer.
    'length_limit TEXT',
    // Questions get asked again in different words. Embedded once on save so
    // paraphrases can be found; short text, so no pooling problem.
    'embedding BLOB',
    'cluster_id INTEGER',
    // Facts rot. Salary drifts, availability changes, "over a year unemployed"
    // becomes eighteen months. A stale answer is worse than none, because it
    // gets pasted without rereading.
    'last_confirmed TEXT',
  ]) {
    try {
      db.exec(`ALTER TABLE application_questions ADD COLUMN ${column}`);
    } catch {
      // Column already exists
    }
  }

  // One answer is reused across many applications, so this is a list rather
  // than a column - and it gives reuse counts for free, which says which
  // answers are worth polishing.
  db.exec(`
    CREATE TABLE IF NOT EXISTS answer_uses (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL,
      job_id TEXT,
      company TEXT,
      used_at TEXT DEFAULT CURRENT_TIMESTAMP,
      edited INTEGER DEFAULT 0
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_questions_key ON application_questions(normalized_key)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_questions_cluster ON application_questions(cluster_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_uses_question ON answer_uses(question_id)`);

  initialised = true;
}

function rowToChunk(r: ChunkRow): Chunk {
  return {
    id: r.id,
    level: r.level as ChunkLevel,
    parentId: r.parent_id || undefined,
    slot: r.slot as Slot,
    content: r.content,
    provenance: r.provenance as Provenance,
    sourceLetter: r.source_letter,
    sourceDate: r.source_date,
    roleTrack: r.role_track as RoleTrack,
    tags: r.tags ? JSON.parse(r.tags) : [],
    voiceEligible: r.voice_eligible === 1,
    timesUsed: r.times_used,
  };
}

export function insertChunk(c: Omit<Chunk, 'id' | 'timesUsed'> & { id?: string }): string {
  initChunkStore();
  const id = c.id || uuidv4();
  db.prepare(`
    INSERT OR REPLACE INTO chunks
      (id, level, parent_id, slot, content, provenance, source_letter, source_date,
       role_track, tags, voice_eligible)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, c.level, c.parentId || null, c.slot, c.content, c.provenance,
    c.sourceLetter, c.sourceDate, c.roleTrack, JSON.stringify(c.tags),
    c.voiceEligible ? 1 : 0
  );
  return id;
}

export interface ChunkQuery {
  slot?: Slot;
  level?: ChunkLevel;
  /** Voice retrieval must pass true. Defaults to voice-eligible only. */
  voiceEligibleOnly?: boolean;
  roleTrack?: RoleTrack;
}

export function getChunks(q: ChunkQuery = {}): Chunk[] {
  initChunkStore();
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (q.slot) { where.push('slot = ?'); params.push(q.slot); }
  if (q.level) { where.push('level = ?'); params.push(q.level); }
  if (q.voiceEligibleOnly !== false) { where.push('voice_eligible = 1'); }
  if (q.roleTrack) { where.push("(role_track = ? OR role_track = 'both')"); params.push(q.roleTrack); }

  const sql = `SELECT * FROM chunks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY source_date DESC`;
  return (db.prepare(sql).all(...params) as ChunkRow[]).map(rowToChunk);
}

export function recordChunkUse(id: string): void {
  initChunkStore();
  db.prepare('UPDATE chunks SET times_used = times_used + 1 WHERE id = ?').run(id);
}

export function chunkStats(): Array<{ provenance: string; slot: string; count: number }> {
  initChunkStore();
  return db.prepare(`
    SELECT provenance, slot, COUNT(*) as count
    FROM chunks GROUP BY provenance, slot ORDER BY provenance, slot
  `).all() as Array<{ provenance: string; slot: string; count: number }>;
}

/** Collapses "Why do you want to work here?" variants onto one key. */
/**
 * A key that collapses the same question asked by different companies.
 *
 * "Why Granola?", "Why METR?" and "Why do you want to work for Zyphra?" are one
 * question to answer, not three - and without stripping the company they
 * normalise to three different keys, which is how six forms produced 43
 * "distinct" questions with nothing merged at all.
 *
 * The company is removed rather than kept, because the cluster is the right
 * unit for retrieval and the wrong unit for reuse: it should be obvious that
 * you are reading a Proton answer while applying to Anthropic, so the company
 * stays on the answer.
 */
export function normalizeQuestion(text: string, company?: string): string {
  let s = text.toLowerCase();

  if (company) {
    const name = company.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    if (name.length >= 3) s = s.replace(new RegExp(`\\b${name}\\b`, 'g'), ' ');
  }

  const key = s
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\b(please|kindly|briefly|tell us|describe|explain|what|why|how|do|does|did|you|your|are|is|the|a|an|for|to|us|we|our|with|at|in|of|would|will|be|it|about|want|like|working|work)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // "Why Granola?" is nothing but a company name and stopwords, so stripping
  // both leaves an empty string - and an empty key collides with every other
  // question that empties out. Fall back to the text without the company
  // removed, which is at least distinct.
  return key || text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

export function recordQuestion(args: {
  questionText: string;
  company?: string;
  jobId?: string;
  answer?: string;
  provenance?: Provenance;
}): string {
  initChunkStore();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO application_questions
      (id, normalized_key, question_text, company, job_id, answer, provenance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, normalizeQuestion(args.questionText), args.questionText,
    args.company || null, args.jobId || null, args.answer || null,
    args.provenance || null
  );
  return id;
}
