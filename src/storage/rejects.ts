/**
 * Postings the gate turned away.
 *
 * Until now filterJobs counted rejects and dropped them, so nothing downstream
 * could ever see what the gate removed. Two consequences, both real: the gate's
 * recall was unmeasurable except by re-fetching every source, and any model
 * trained on the jobs table learns from survivors only while being asked to
 * rank the whole stream.
 *
 * Kept in its own table rather than in `jobs` with a flag, so the candidates UI,
 * the review passes, the archiver and every existing query stay exactly as they
 * are. Nothing here is a candidate; it is a record of a decision.
 *
 * Descriptions are capped well below the jobs table's 50,000. These rows exist
 * to be sampled and scored, not read, and the corpus grows by a few thousand
 * every scrape.
 */

import { db } from './db.js';
import { cleanJobDescription } from '../utils/jobText.js';
import type { RawJob } from '../types.js';

const DESCRIPTION_CAP = 4000;

db.exec(`
  CREATE TABLE IF NOT EXISTS rejected_jobs (
    url TEXT PRIMARY KEY,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    times_seen INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT NOT NULL,
    description TEXT NOT NULL,
    score INTEGER NOT NULL,
    reason TEXT NOT NULL
  )
`);

export interface RejectedJob {
  job: RawJob;
  score: number;
  /** The rule that turned it away, or the absence of a passing rule. */
  reason: string;
}

/**
 * Upserts, counting repeat sightings. A posting rejected on every scrape for a
 * month is one row seen sixty times, not sixty rows - and how often something
 * recurs is itself worth knowing.
 */
export function recordRejects(rejects: RejectedJob[]): number {
  const stmt = db.prepare(`
    INSERT INTO rejected_jobs
      (url, first_seen, last_seen, times_seen, source, title, company, location, description, score, reason)
    VALUES (@url, @now, @now, 1, @source, @title, @company, @location, @description, @score, @reason)
    ON CONFLICT(url) DO UPDATE SET
      last_seen = @now,
      times_seen = times_seen + 1,
      score = @score,
      reason = @reason
  `);

  const now = new Date().toISOString();
  const run = db.transaction((batch: RejectedJob[]) => {
    let n = 0;
    for (const r of batch) {
      if (!r.job.url) continue;
      n += stmt.run({
        url: r.job.url,
        now,
        source: r.job.source,
        title: r.job.title ?? '',
        company: r.job.company ?? '',
        location: r.job.location ?? '',
        description: cleanJobDescription(r.job.description).slice(0, DESCRIPTION_CAP),
        score: r.score,
        reason: r.reason,
      }).changes;
    }
    return n;
  });

  return run(rejects);
}

export function rejectStats(): { total: number; sources: number } {
  const r = db.prepare(
    'SELECT COUNT(*) total, COUNT(DISTINCT source) sources FROM rejected_jobs'
  ).get() as { total: number; sources: number };
  return r;
}
