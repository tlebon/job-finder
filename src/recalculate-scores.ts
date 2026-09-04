#!/usr/bin/env tsx
/**
 * Recalculate scores and tech categories for stored jobs.
 *
 * Delegates to filterJob() rather than reimplementing the scoring maths. An
 * earlier version duplicated it, and the two silently diverged the moment the
 * scorer changed.
 *
 * Jobs that no longer pass the filter are reported but not zeroed: a config
 * change should not silently wipe the score of something already actioned.
 *
 * Usage:
 *   npx tsx src/recalculate-scores.ts --dry-run
 *   npx tsx src/recalculate-scores.ts --confirm [--prune]
 *
 * --prune archives jobs that no longer pass the filter. Needed after a filter
 * change, since jobs admitted under looser rules otherwise sit in the list
 * forever. Never touches anything the user has acted on.
 */

import { config } from 'dotenv';
import { db } from './storage/db.js';
import { filterJob } from './filters/jobFilter.js';
import type { RawJob } from './types.js';

config({ quiet: true });

interface JobRow {
  id: string;
  title: string;
  description: string | null;
  location: string;
  company: string;
  url: string;
  source: string;
  score: number | null;
  status: string;
  ai_score_adjustment: number | null;
  ai_reviewed: number | null;
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const confirm = args.includes('--confirm');
  const prune = args.includes('--prune');

  if (!dryRun && !confirm) {
    console.error('Specify --dry-run or --confirm');
    process.exit(1);
  }

  const jobs = db.prepare(`
    SELECT id, title, description, location, company, url, source, score, status,
           ai_score_adjustment, ai_reviewed
    FROM jobs
    WHERE status NOT IN ('ARCHIVED', 'DEAD', 'EXPIRED')
  `).all() as JobRow[];

  console.log(`Recalculating ${jobs.length} jobs\n`);

  const update = db.prepare('UPDATE jobs SET score = ?, categories = ?, requires_relocation = ? WHERE id = ?');
  const archive = db.prepare("UPDATE jobs SET status = 'ARCHIVED', updated_at = ? WHERE id = ?");

  let changed = 0;
  let unchanged = 0;
  let nowExcluded = 0;
  let pruned = 0;
  let unreconstructable = 0;
  const deltas: number[] = [];

  for (const job of jobs) {
    const result = filterJob({
      title: job.title,
      description: job.description || '',
      company: job.company,
      location: job.location,
      url: job.url,
      source: job.source,
    } as RawJob);

    if (!result.passed) {
      nowExcluded++;
      // Only prune untouched jobs. Anything applied to, interviewing, or
      // explicitly marked stays regardless of what the filter now thinks.
      if (prune && confirm && (job.status === 'NEW' || job.status === 'PENDING')) {
        archive.run(new Date().toISOString(), job.id);
        pruned++;
      }
      continue;
    }

    // Re-apply the AI's adjustment on top of the fresh regex score, so
    // recalculating never discards review signal.
    //
    // Jobs reviewed before the adjustment column was recorded have it NULL
    // while their `score` still contains the adjustment. Recomputing those from
    // the regex alone would silently strip it, so they are left untouched and
    // counted instead. They correct themselves on their next review.
    if (job.ai_reviewed === 1 && job.ai_score_adjustment === null) {
      unreconstructable++;
      continue;
    }
    const adjustment = job.ai_score_adjustment ?? 0;
    const newScore = result.score + adjustment;
    const oldScore = job.score || 0;
    const delta = newScore - oldScore;

    if (delta !== 0) {
      deltas.push(delta);
      changed++;
      if (confirm) {
        update.run(newScore, JSON.stringify(result.categories), result.requiresRelocation ? 1 : 0, job.id);
      }
    } else {
      unchanged++;
      if (confirm) {
        update.run(newScore, JSON.stringify(result.categories), result.requiresRelocation ? 1 : 0, job.id);
      }
    }
  }

  deltas.sort((a, b) => a - b);
  const median = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 0;

  if (unreconstructable > 0) {
    console.log(`Skipped ${unreconstructable} jobs reviewed before ai_score_adjustment was recorded`);
    console.log('  (their score still holds the adjustment; recomputing would strip it)');
  }
  console.log(`Changed:      ${changed}`);
  console.log(`Unchanged:    ${unchanged}`);
  console.log(`No longer passing filter: ${nowExcluded}${prune ? ` (${pruned} archived)` : ' (left untouched; pass --prune to archive)'}`);
  if (deltas.length) {
    console.log(`Score delta:  median ${median}, min ${deltas[0]}, max ${deltas[deltas.length - 1]}`);
  }

  console.log(dryRun ? '\nDRY RUN: nothing written.\n' : '\nScores and categories updated.\n');
}

main();
