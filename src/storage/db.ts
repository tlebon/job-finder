import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import type { Job, RawJob } from '../types.js';
import { cleanJobDescription } from '../utils/jobText.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use DATABASE_PATH env var if set (for Docker), otherwise use project root
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'jobs.db');
const db: DatabaseType = new Database(dbPath);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Create table if not exists
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    date_found TEXT NOT NULL,
    source TEXT NOT NULL,
    company TEXT NOT NULL,
    title TEXT NOT NULL,
    location TEXT NOT NULL,
    url TEXT UNIQUE NOT NULL,
    description TEXT,
    cover_letter TEXT,
    status TEXT DEFAULT 'NEW',
    score INTEGER DEFAULT 0,
    notes TEXT,
    applied_date TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Add score column if it doesn't exist (migration)
try {
  db.exec(`ALTER TABLE jobs ADD COLUMN score INTEGER DEFAULT 0`);
} catch {
  // Column already exists
}

// Add AI review columns (migration)
try {
  db.exec(`ALTER TABLE jobs ADD COLUMN ai_reviewed INTEGER DEFAULT 0`);
  db.exec(`ALTER TABLE jobs ADD COLUMN ai_suggestion TEXT`);
  db.exec(`ALTER TABLE jobs ADD COLUMN ai_reasoning TEXT`);
} catch {
  // Columns already exist
}

// Record who set a status (migration).
//
// A dismissal Tim made by hand and one the reviewer made automatically both
// wrote NOT_FIT and were indistinguishable afterwards, so every human judgement
// this app collected was discarded on write. Existing rows are left NULL rather
// than guessed at - the information is genuinely gone for those, and inventing
// it would poison the only labels worth trusting.
//
// Each ALTER gets its own try: one failing statement inside a shared block
// skips the ones after it, which is how a migration silently half-applies.
try {
  db.exec(`ALTER TABLE jobs ADD COLUMN status_source TEXT`);
} catch {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE jobs ADD COLUMN status_changed_at TEXT`);
} catch {
  // Column already exists
}

// Add job cleanup tracking columns (migration).
// No DEFAULT CURRENT_TIMESTAMP here: SQLite rejects ADD COLUMN with a
// non-constant default, so the column is backfilled below instead.
try {
  db.exec(`ALTER TABLE jobs ADD COLUMN updated_at TEXT`);
} catch {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE jobs ADD COLUMN last_url_check TEXT`);
} catch {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE jobs ADD COLUMN check_failures INTEGER DEFAULT 0`);
} catch {
  // Column already exists
}

// Tech categories matched at filter time (JSON array). Drives UI filters.
try {
  db.exec(`ALTER TABLE jobs ADD COLUMN categories TEXT`);
} catch {
  // Column already exists
}

// Store the AI's score adjustment separately. Folding it only into `score` made
// recalculation destructive: the regex score overwrote it and it could not be
// reconstructed. Kept apart, recalculation is idempotent.
try {
  db.exec(`ALTER TABLE jobs ADD COLUMN ai_score_adjustment INTEGER`);
} catch {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE jobs ADD COLUMN requires_relocation INTEGER DEFAULT 0`);
} catch {
  // Column already exists
}

// Set updated_at = created_at for existing jobs
try {
  db.exec(`UPDATE jobs SET updated_at = created_at WHERE updated_at IS NULL`);
} catch {
  // Already migrated
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_date_found ON jobs(date_found);
`);

// Blocklist table for learning from NOT_FIT feedback
db.exec(`
  CREATE TABLE IF NOT EXISTS blocklist (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    reason TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(type, value)
  )
`);

export interface BlocklistEntry {
  id: string;
  type: 'company' | 'keyword' | 'title_pattern';
  value: string;
  reason?: string;
  createdAt: string;
}

export function getBlocklist(): BlocklistEntry[] {
  const rows = db.prepare('SELECT * FROM blocklist').all() as {
    id: string;
    type: string;
    value: string;
    reason: string | null;
    created_at: string;
  }[];
  return rows.map(r => ({
    id: r.id,
    type: r.type as BlocklistEntry['type'],
    value: r.value,
    reason: r.reason || undefined,
    createdAt: r.created_at,
  }));
}

export function addToBlocklist(type: BlocklistEntry['type'], value: string, reason?: string): boolean {
  try {
    const id = uuidv4();
    db.prepare(`
      INSERT OR IGNORE INTO blocklist (id, type, value, reason)
      VALUES (?, ?, ?, ?)
    `).run(id, type, value, reason || null);
    console.log(`Added to blocklist: ${type} = "${value}"`);
    return true;
  } catch {
    return false;
  }
}

export function removeFromBlocklist(id: string): boolean {
  const result = db.prepare('DELETE FROM blocklist WHERE id = ?').run(id);
  return result.changes > 0;
}

export function getExistingJobUrls(): Set<string> {
  const rows = db.prepare('SELECT url FROM jobs').all() as { url: string }[];
  const urls = new Set(rows.map(r => r.url));
  console.log(`Found ${urls.size} existing jobs in database`);
  return urls;
}

// Normalize title for duplicate detection
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(m\/w\/[dx*]\)/gi, '') // Remove gender markers like (m/w/d)
    .replace(/\(all genders?\)/gi, '')
    .replace(/\(remote\)/gi, '')
    .replace(/[^a-z0-9]/g, '') // Remove special chars
    .trim();
}

// Get existing job signatures for duplicate detection
export function getExistingJobSignatures(): Set<string> {
  const rows = db.prepare('SELECT company, title FROM jobs').all() as { company: string; title: string }[];
  const signatures = new Set(rows.map(r => `${r.company.toLowerCase()}|${normalizeTitle(r.title)}`));
  return signatures;
}

// Check if a job is a duplicate (same company + similar title)
export function isDuplicateJob(company: string, title: string, existingSignatures: Set<string>): boolean {
  const signature = `${company.toLowerCase()}|${normalizeTitle(title)}`;
  return existingSignatures.has(signature);
}

export function appendJobs(jobs: Job[]): number {
  if (jobs.length === 0) {
    console.log('No jobs to append');
    return 0;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO jobs (id, date_found, source, company, title, location, url, description, cover_letter, status, score, categories, requires_relocation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((jobs: Job[]) => {
    let count = 0;
    for (const job of jobs) {
      const result = insert.run(
        job.id,
        job.dateFound,
        job.source,
        job.company,
        job.title,
        job.location,
        job.url,
        cleanJobDescription(job.description).substring(0, 50000), // strip markup, then cap
        job.coverLetter || null,
        job.status || 'NEW',
        job.score || 0,
        job.categories ? JSON.stringify(job.categories) : null,
        job.requiresRelocation ? 1 : 0
      );
      if (result.changes > 0) count++;
    }
    return count;
  });

  const inserted = insertMany(jobs);
  console.log(`Inserted ${inserted} jobs into database`);
  return inserted;
}

export function rawJobToJob(rawJob: RawJob, coverLetter?: string, status: Job['status'] = 'NEW'): Job {
  return {
    id: uuidv4(),
    dateFound: new Date().toISOString(),
    source: rawJob.source,
    company: rawJob.company,
    title: rawJob.title,
    location: rawJob.location,
    url: rawJob.url,
    description: rawJob.description,
    coverLetter,
    status,
    score: (rawJob as RawJob & { score?: number }).score,
    categories: (rawJob as RawJob & { categories?: string[] }).categories,
    requiresRelocation: (rawJob as RawJob & { requiresRelocation?: boolean }).requiresRelocation,
  };
}

// AI Review functions
export type AISuggestion = 'STRONG_FIT' | 'GOOD_FIT' | 'MAYBE' | 'AUTO_DISMISS';

export interface AIReviewResult {
  jobId: string;
  suggestion: AISuggestion;
  reasoning: string;
  scoreAdjustment: number;
}

export function updateJobWithAIReview(result: AIReviewResult): void {
  db.prepare(`
    UPDATE jobs
    SET ai_reviewed = 1,
        ai_suggestion = ?,
        ai_reasoning = ?,
        ai_score_adjustment = ?,
        score = score + ? - COALESCE(ai_score_adjustment, 0)
    WHERE id = ?
  `).run(
    result.suggestion,
    result.reasoning,
    result.scoreAdjustment,
    result.scoreAdjustment,
    result.jobId
  );
}

export function updateJobCategories(jobId: string, categories: string[]): void {
  db.prepare('UPDATE jobs SET categories = ? WHERE id = ?').run(JSON.stringify(categories), jobId);
}

/**
 * Who decided this status.
 *
 * 'user' is the only one of these that is ground truth. Until now a dismissal
 * Tim made by hand and one the reviewer made automatically both wrote NOT_FIT
 * and became indistinguishable, so thousands of real human judgements were
 * discarded on write. Those are the only labels that can tell us the reviewer
 * is wrong rather than merely inconsistent, which makes them the most valuable
 * data this project produces.
 */
export type StatusSource = 'user' | 'ai' | 'system';

export function updateJobStatus(jobId: string, status: string, source: StatusSource = 'user'): void {
  db.prepare('UPDATE jobs SET status = ?, status_source = ?, status_changed_at = ? WHERE id = ?')
    .run(status, source, new Date().toISOString(), jobId);
}

export function getJobById(jobId: string): Job | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as {
    id: string;
    date_found: string;
    source: string;
    company: string;
    title: string;
    location: string;
    url: string;
    description: string | null;
    cover_letter: string | null;
    status: string;
    score: number;
  } | undefined;

  if (!row) return null;

  return {
    id: row.id,
    dateFound: row.date_found,
    source: row.source as Job['source'],
    company: row.company,
    title: row.title,
    location: row.location,
    url: row.url,
    description: row.description || '',
    coverLetter: row.cover_letter || '',
    status: row.status as Job['status'],
    score: row.score,
  };
}

// ============ PROFILE (for AI review) ============

export interface Profile {
  name: string;
  title: string;
  location: string;
  skills: string;
  experience: string;
  preferences: string;
}

export function getProfile(): Profile | null {
  // Profile table may not exist yet if web app hasn't been run
  try {
    const row = db.prepare('SELECT * FROM profile WHERE id = ?').get('default') as {
      name: string | null;
      title: string | null;
      location: string | null;
      skills: string | null;
      experience: string | null;
      preferences: string | null;
    } | undefined;

    if (!row) return null;

    return {
      name: row.name || '',
      title: row.title || '',
      location: row.location || '',
      skills: row.skills || '',
      experience: row.experience || '',
      preferences: row.preferences || '',
    };
  } catch {
    // Profile table doesn't exist
    return null;
  }
}

export { db };
