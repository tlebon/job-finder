#!/usr/bin/env tsx
/**
 * Review the backlog of jobs that were never AI-reviewed. See review/backlog.ts
 * for why a backlog exists at all.
 *
 * Usage:
 *   npx tsx src/review-pending.ts --dry-run
 *   npx tsx src/review-pending.ts --confirm [--limit=200] [--sources=80000hours,ats]
 *   npx tsx src/review-pending.ts --confirm --include-stale
 *
 * --include-stale also re-reviews jobs judged by an older prompt, identified by
 * a missing ai_reach. Those verdicts came from the version asking whether Tim
 * was qualified rather than whether he would apply, which measured 55% recall
 * against his own labels where the replacement gets 68%.
 *
 * Prefer --sources over --min-score when trimming to a budget: the score does
 * not rank (see review/backlog.ts), the source does.
 */

import { config } from 'dotenv';
import { getProfile } from './storage/db.js';
import { findUnreviewed, reviewAndPersist } from './review/backlog.js';

config({ quiet: true });

const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const raw = args.find(a => a.startsWith(`--${name}=`));
  return raw ? Number(raw.split('=')[1]) : fallback;
};

const limit = flag('limit', 0);
const minScore = flag('min-score', 0);
const sourcesArg = args.find(a => a.startsWith('--sources='));
const sources = sourcesArg ? sourcesArg.split('=')[1].split(',').filter(Boolean) : undefined;
const includeStale = args.includes('--include-stale');
const jobs = findUnreviewed({ limit, minScore, sources, includeStale });

console.log(`${jobs.length} ${includeStale ? 'unreviewed or stale' : 'unreviewed'} jobs` +
  `${minScore ? ` scoring >= ${minScore}` : ''}${sources ? ` from ${sources.join(', ')}` : ''}`);
if (jobs.length === 0) process.exit(0);

const bySource = jobs.reduce<Record<string, number>>((acc, j) => {
  acc[j.source] = (acc[j.source] ?? 0) + 1;
  return acc;
}, {});
console.log('By source:', Object.entries(bySource).sort((a, b) => b[1] - a[1])
  .map(([s, n]) => `${s} ${n}`).join(', '));
console.log(`Score range: ${jobs[jobs.length - 1].score} - ${jobs[0].score}`);

if (!args.includes('--confirm')) {
  console.log('\nTop 15 that would be reviewed:');
  jobs.slice(0, 15).forEach((j, i) =>
    console.log(`  ${String(i + 1).padStart(2)}. [${j.score}] ${j.title} @ ${j.company}`));
  console.log('\nDRY RUN: pass --confirm to review.');
  process.exit(0);
}

const profile = getProfile();
if (!profile) {
  console.error('No profile stored - review would have nothing to judge against.');
  process.exit(1);
}

const tally = await reviewAndPersist(jobs, profile, (done, total) =>
  console.log(`  -- ${done}/${total} reviewed and saved`));

console.log('\nDone.');
for (const key of ['STRONG_FIT', 'GOOD_FIT', 'MAYBE', 'AUTO_DISMISS']) {
  console.log(`  ${key.padEnd(13)} ${tally[key] ?? 0}`);
}
