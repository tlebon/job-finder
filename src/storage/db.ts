import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import type { Job, RawJob } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Store database in project root
const dbPath = path.join(__dirname, '..', '..', 'jobs.db');
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
    INSERT OR IGNORE INTO jobs (id, date_found, source, company, title, location, url, description, cover_letter, status, score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        job.description?.substring(0, 50000) || '', // Limit description size
        job.coverLetter || null,
        job.status || 'NEW',
        job.score || 0
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
  };
}

export { db };
