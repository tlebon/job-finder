import Database from 'better-sqlite3';
import path from 'path';

// Use DATABASE_PATH env var if set (for Docker), otherwise use parent directory
const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), '..', 'jobs.db');
const db = new Database(dbPath);

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

// Create index for common queries
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

// Profile table for user info (used in cover letters)
db.exec(`
  CREATE TABLE IF NOT EXISTS profile (
    id TEXT PRIMARY KEY DEFAULT 'default',
    name TEXT,
    title TEXT,
    location TEXT,
    email TEXT,
    phone TEXT,
    linkedin TEXT,
    github TEXT,
    website TEXT,
    summary TEXT,
    experience TEXT,
    skills TEXT,
    preferences TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Filter rules table (configurable filtering)
db.exec(`
  CREATE TABLE IF NOT EXISTS filter_rules (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    pattern TEXT NOT NULL,
    weight INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Job queue table (persist generation jobs)
db.exec(`
  CREATE TABLE IF NOT EXISTS job_queue (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    error TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  )
`);

export type AISuggestion = 'STRONG_FIT' | 'GOOD_FIT' | 'MAYBE' | 'AUTO_DISMISS';

export interface Job {
  id: string;
  dateFound: string;
  source: string;
  company: string;
  title: string;
  location: string;
  url: string;
  description: string;
  coverLetter: string;
  status: string;
  score: number;
  notes?: string;
  appliedDate?: string;
  aiReviewed?: boolean;
  aiSuggestion?: AISuggestion;
  aiReasoning?: string;
}

interface JobRow {
  id: string;
  date_found: string;
  source: string;
  company: string;
  title: string;
  location: string;
  url: string;
  description: string | null;
  cover_letter: string | null;
  status: string | null;
  score: number | null;
  notes: string | null;
  applied_date: string | null;
  ai_reviewed: number | null;
  ai_suggestion: string | null;
  ai_reasoning: string | null;
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    dateFound: row.date_found,
    source: row.source,
    company: row.company,
    title: row.title,
    location: row.location,
    url: row.url,
    description: row.description || '',
    coverLetter: row.cover_letter || '',
    status: row.status || 'NEW',
    score: row.score || 0,
    notes: row.notes || undefined,
    appliedDate: row.applied_date || undefined,
    aiReviewed: row.ai_reviewed === 1,
    aiSuggestion: row.ai_suggestion as AISuggestion | undefined,
    aiReasoning: row.ai_reasoning || undefined,
  };
}

export function getJobs(): Job[] {
  const rows = db.prepare('SELECT * FROM jobs ORDER BY date_found DESC').all() as JobRow[];
  return rows.map(rowToJob);
}

export function getJobById(id: string): Job | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  return row ? rowToJob(row) : null;
}

export function getJobByUrl(url: string): Job | null {
  const row = db.prepare('SELECT * FROM jobs WHERE url = ?').get(url) as JobRow | undefined;
  return row ? rowToJob(row) : null;
}

export function updateJobCoverLetter(id: string, coverLetter: string): boolean {
  const result = db.prepare('UPDATE jobs SET cover_letter = ? WHERE id = ?').run(coverLetter, id);
  return result.changes > 0;
}

export function updateJobStatus(id: string, status: string): boolean {
  const result = db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, id);
  return result.changes > 0;
}

export function deleteJob(id: string): boolean {
  const result = db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  return result.changes > 0;
}

export function insertJob(job: Job): void {
  db.prepare(`
    INSERT OR REPLACE INTO jobs (id, date_found, source, company, title, location, url, description, cover_letter, status, notes, applied_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.id,
    job.dateFound,
    job.source,
    job.company,
    job.title,
    job.location,
    job.url,
    job.description,
    job.coverLetter || null,
    job.status || 'NEW',
    job.notes || null,
    job.appliedDate || null
  );
}

export function getExistingJobUrls(): Set<string> {
  const rows = db.prepare('SELECT url FROM jobs').all() as { url: string }[];
  return new Set(rows.map(r => r.url));
}

export function insertJobs(jobs: Job[]): number {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO jobs (id, date_found, source, company, title, location, url, description, cover_letter, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        job.description,
        job.coverLetter || null,
        job.status || 'NEW'
      );
      if (result.changes > 0) count++;
    }
    return count;
  });

  return insertMany(jobs);
}

// Blocklist functions
export interface BlocklistEntry {
  id: string;
  type: 'company' | 'keyword' | 'title_pattern';
  value: string;
  reason?: string;
  createdAt: string;
}

export function getBlocklist(): BlocklistEntry[] {
  const rows = db.prepare('SELECT * FROM blocklist ORDER BY created_at DESC').all() as {
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
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT OR IGNORE INTO blocklist (id, type, value, reason)
      VALUES (?, ?, ?, ?)
    `).run(id, type, value, reason || null);
    return true;
  } catch {
    return false;
  }
}

export function removeFromBlocklist(id: string): boolean {
  const result = db.prepare('DELETE FROM blocklist WHERE id = ?').run(id);
  return result.changes > 0;
}

// Get jobs by status (sorted by score descending, then date)
export function getJobsByStatus(status: string): Job[] {
  const rows = db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY score DESC, date_found DESC').all(status) as JobRow[];
  return rows.map(rowToJob);
}

// Get jobs added since a specific date (for summary feature)
export function getJobsSince(since: string): Job[] {
  const rows = db.prepare('SELECT * FROM jobs WHERE date_found > ? ORDER BY score DESC').all(since) as JobRow[];
  return rows.map(rowToJob);
}

// Get top new jobs with AI review data since a date
export function getTopJobsSince(since: string, limit: number = 5): Job[] {
  const rows = db.prepare(`
    SELECT * FROM jobs
    WHERE date_found > ?
      AND ai_suggestion IN ('STRONG_FIT', 'GOOD_FIT')
    ORDER BY
      CASE ai_suggestion
        WHEN 'STRONG_FIT' THEN 1
        WHEN 'GOOD_FIT' THEN 2
        ELSE 3
      END,
      score DESC
    LIMIT ?
  `).all(since, limit) as JobRow[];
  return rows.map(rowToJob);
}

// Update job with cover letter and status
export function updateJobWithLetter(id: string, coverLetter: string, status: string = 'NEW'): boolean {
  const result = db.prepare('UPDATE jobs SET cover_letter = ?, status = ? WHERE id = ?').run(coverLetter, status, id);
  return result.changes > 0;
}

// ============ PROFILE ============

export interface Profile {
  id: string;
  name: string;
  title: string;
  location: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  website: string;
  summary: string;
  experience: string;
  skills: string;
  preferences: string;
  updatedAt: string;
}

export function getProfile(): Profile | null {
  const row = db.prepare('SELECT * FROM profile WHERE id = ?').get('default') as {
    id: string;
    name: string | null;
    title: string | null;
    location: string | null;
    email: string | null;
    phone: string | null;
    linkedin: string | null;
    github: string | null;
    website: string | null;
    summary: string | null;
    experience: string | null;
    skills: string | null;
    preferences: string | null;
    updated_at: string;
  } | undefined;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name || '',
    title: row.title || '',
    location: row.location || '',
    email: row.email || '',
    phone: row.phone || '',
    linkedin: row.linkedin || '',
    github: row.github || '',
    website: row.website || '',
    summary: row.summary || '',
    experience: row.experience || '',
    skills: row.skills || '',
    preferences: row.preferences || '',
    updatedAt: row.updated_at,
  };
}

export function saveProfile(profile: Partial<Profile>): boolean {
  const existing = getProfile();

  if (existing) {
    const result = db.prepare(`
      UPDATE profile SET
        name = ?, title = ?, location = ?, email = ?, phone = ?,
        linkedin = ?, github = ?, website = ?, summary = ?,
        experience = ?, skills = ?, preferences = ?, updated_at = ?
      WHERE id = 'default'
    `).run(
      profile.name || existing.name,
      profile.title || existing.title,
      profile.location || existing.location,
      profile.email || existing.email,
      profile.phone || existing.phone,
      profile.linkedin || existing.linkedin,
      profile.github || existing.github,
      profile.website || existing.website,
      profile.summary || existing.summary,
      profile.experience || existing.experience,
      profile.skills || existing.skills,
      profile.preferences || existing.preferences,
      new Date().toISOString()
    );
    return result.changes > 0;
  } else {
    db.prepare(`
      INSERT INTO profile (id, name, title, location, email, phone, linkedin, github, website, summary, experience, skills, preferences)
      VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      profile.name || '',
      profile.title || '',
      profile.location || '',
      profile.email || '',
      profile.phone || '',
      profile.linkedin || '',
      profile.github || '',
      profile.website || '',
      profile.summary || '',
      profile.experience || '',
      profile.skills || '',
      profile.preferences || ''
    );
    return true;
  }
}

// ============ FILTER RULES ============

export interface FilterRule {
  id: string;
  type: 'include_title' | 'exclude_title' | 'include_tech' | 'include_location' | 'boost' | 'include_company_type';
  pattern: string;
  weight: number;
  enabled: boolean;
  createdAt: string;
}

export function getFilterRules(): FilterRule[] {
  const rows = db.prepare('SELECT * FROM filter_rules ORDER BY type, pattern').all() as {
    id: string;
    type: string;
    pattern: string;
    weight: number;
    enabled: number;
    created_at: string;
  }[];

  return rows.map(r => ({
    id: r.id,
    type: r.type as FilterRule['type'],
    pattern: r.pattern,
    weight: r.weight,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
  }));
}

export function addFilterRule(type: FilterRule['type'], pattern: string, weight: number = 0): string {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO filter_rules (id, type, pattern, weight)
    VALUES (?, ?, ?, ?)
  `).run(id, type, pattern, weight);
  return id;
}

export function updateFilterRule(id: string, updates: Partial<FilterRule>): boolean {
  const setClauses: string[] = [];
  const values: (string | number)[] = [];

  if (updates.pattern !== undefined) {
    setClauses.push('pattern = ?');
    values.push(updates.pattern);
  }
  if (updates.weight !== undefined) {
    setClauses.push('weight = ?');
    values.push(updates.weight);
  }
  if (updates.enabled !== undefined) {
    setClauses.push('enabled = ?');
    values.push(updates.enabled ? 1 : 0);
  }

  if (setClauses.length === 0) return false;

  values.push(id);
  const result = db.prepare(`UPDATE filter_rules SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deleteFilterRule(id: string): boolean {
  const result = db.prepare('DELETE FROM filter_rules WHERE id = ?').run(id);
  return result.changes > 0;
}

// ============ JOB QUEUE ============

export interface QueuedJob {
  id: string;
  jobId: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export function getJobQueue(): QueuedJob[] {
  const rows = db.prepare('SELECT * FROM job_queue ORDER BY created_at ASC').all() as {
    id: string;
    job_id: string;
    status: string;
    error: string | null;
    created_at: string;
    completed_at: string | null;
  }[];

  return rows.map(r => ({
    id: r.id,
    jobId: r.job_id,
    status: r.status as QueuedJob['status'],
    error: r.error || undefined,
    createdAt: r.created_at,
    completedAt: r.completed_at || undefined,
  }));
}

export function getPendingQueue(): QueuedJob[] {
  const rows = db.prepare("SELECT * FROM job_queue WHERE status IN ('pending', 'processing') ORDER BY created_at ASC").all() as {
    id: string;
    job_id: string;
    status: string;
    error: string | null;
    created_at: string;
    completed_at: string | null;
  }[];

  return rows.map(r => ({
    id: r.id,
    jobId: r.job_id,
    status: r.status as QueuedJob['status'],
    error: r.error || undefined,
    createdAt: r.created_at,
    completedAt: r.completed_at || undefined,
  }));
}

export function addToQueue(jobIds: string[]): number {
  const insert = db.prepare('INSERT INTO job_queue (id, job_id, status) VALUES (?, ?, ?)');
  const insertMany = db.transaction((ids: string[]) => {
    let count = 0;
    for (const jobId of ids) {
      insert.run(crypto.randomUUID(), jobId, 'pending');
      count++;
    }
    return count;
  });
  return insertMany(jobIds);
}

export function updateQueueStatus(id: string, status: QueuedJob['status'], error?: string): boolean {
  const completedAt = status === 'done' || status === 'failed' ? new Date().toISOString() : null;
  const result = db.prepare('UPDATE job_queue SET status = ?, error = ?, completed_at = ? WHERE id = ?')
    .run(status, error || null, completedAt, id);
  return result.changes > 0;
}

export function clearCompletedQueue(): number {
  const result = db.prepare("DELETE FROM job_queue WHERE status IN ('done', 'failed')").run();
  return result.changes;
}

export { db };
