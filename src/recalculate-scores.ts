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
 *   npx tsx src/recalculate-scores.ts --confirm
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
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const confirm = args.includes('--confirm');

  if (!dryRun && !confirm) {
    console.error('Specify --dry-run or --confirm');
    process.exit(1);
  }

  const jobs = db.prepare(`
    SELECT id, title, description, location, company, url, source, score, status
    FROM jobs
    WHERE status NOT IN ('ARCHIVED', 'DEAD', 'EXPIRED')
  `).all() as JobRow[];

  console.log(`Recalculating ${jobs.length} jobs\n`);

  const update = db.prepare('UPDATE jobs SET score = ?, categories = ? WHERE id = ?');

  let changed = 0;
  let unchanged = 0;
  let nowExcluded = 0;
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
      continue;
    }

    const oldScore = job.score || 0;
    const delta = result.score - oldScore;

    if (delta !== 0) {
      deltas.push(delta);
      changed++;
      if (confirm) {
        update.run(result.score, JSON.stringify(result.categories), job.id);
      }
    } else {
      unchanged++;
      if (confirm) {
        update.run(result.score, JSON.stringify(result.categories), job.id);
      }
    }
  }

  deltas.sort((a, b) => a - b);
  const median = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 0;

  console.log(`Changed:      ${changed}`);
  console.log(`Unchanged:    ${unchanged}`);
  console.log(`No longer passing filter (left untouched): ${nowExcluded}`);
  if (deltas.length) {
    console.log(`Score delta:  median ${median}, min ${deltas[0]}, max ${deltas[deltas.length - 1]}`);
  }

  console.log(dryRun ? '\nDRY RUN: nothing written.\n' : '\nScores and categories updated.\n');
}

main();
