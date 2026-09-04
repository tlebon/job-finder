/**
 * The unreviewed backlog.
 *
 * AI review only ever ran inside a scrape, over that run's own batch, so
 * anything that entered the database another way never got a verdict: jobs
 * restored from NOT_FIT, jobs un-archived by hand, jobs from a source wired up
 * after the fact, and every job in a run whose review step failed or whose
 * process was killed by a deploy rollover. Those jobs sort into the middle of
 * the candidates list carrying no verdict at all.
 */

import { db, updateJobStatus, updateJobWithAIReview } from '../storage/db.js';
import { reviewCandidates, type Profile } from '../ai/reviewCandidates.js';
import type { Job } from '../types.js';

/** Persist after each chunk, so a killed run keeps the work it paid for. */
const CHUNK = 20;

export interface BacklogQuery {
  limit?: number;
  minScore?: number;
}

/** Highest-scoring first, so a limited run spends the budget where it matters. */
export function findUnreviewed({ limit = 0, minScore = 0 }: BacklogQuery = {}): Job[] {
  return db.prepare(`
    SELECT * FROM jobs
    WHERE (ai_reviewed = 0 OR ai_reviewed IS NULL)
      AND status IN ('PENDING', 'NEW')
      AND score >= ?
    ORDER BY score DESC
    ${limit > 0 ? 'LIMIT ?' : ''}
  `).all(...(limit > 0 ? [minScore, limit] : [minScore])) as Job[];
}

export type Tally = Record<string, number>;

export async function reviewAndPersist(
  jobs: Job[],
  profile: Profile,
  onProgress?: (done: number, total: number) => void
): Promise<Tally> {
  const tally: Tally = { STRONG_FIT: 0, GOOD_FIT: 0, MAYBE: 0, AUTO_DISMISS: 0 };

  for (let i = 0; i < jobs.length; i += CHUNK) {
    const chunk = jobs.slice(i, i + CHUNK);
    const results = await reviewCandidates(chunk, profile);

    for (const result of results) {
      if (result.suggestion === 'AUTO_DISMISS') updateJobStatus(result.jobId, 'NOT_FIT');
      updateJobWithAIReview(result);
      tally[result.suggestion] = (tally[result.suggestion] ?? 0) + 1;
    }

    onProgress?.(Math.min(i + CHUNK, jobs.length), jobs.length);
  }

  return tally;
}
