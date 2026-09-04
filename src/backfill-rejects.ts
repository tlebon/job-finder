#!/usr/bin/env tsx
/**
 * Populate rejected_jobs now, rather than waiting for scrapes to accumulate it.
 *
 * The scraper records rejects from here on, but the table starts empty and the
 * questions that need it - what the gate's recall is, how to rank the part of
 * the stream it removes - are open today. One fetch of every source recovers
 * roughly a scrape's worth immediately.
 *
 * Touches rejected_jobs only. No job is added, reviewed, scored or archived,
 * and nothing that passes the gate is written anywhere.
 *
 * Usage:
 *   npx tsx src/backfill-rejects.ts --dry-run
 *   npx tsx src/backfill-rejects.ts --confirm
 */

import { config } from 'dotenv';
import { fetchAllJobs } from './sources/index.js';
import { filterJobs } from './filters/jobFilter.js';
import { recordRejects, rejectStats } from './storage/rejects.js';

config({ quiet: true });

const confirm = process.argv.includes('--confirm');

console.log('Fetching all sources...');
const all = await fetchAllJobs();

const seen = new Set<string>();
const unique = all.filter(j => {
  if (!j.url || seen.has(j.url)) return false;
  seen.add(j.url);
  return true;
});

const { passed, rejected } = filterJobs(unique);
console.log(`\n${unique.length} unique postings: ${passed.length} passed, ${rejected.length} rejected`);

const byReason = new Map<string, number>();
for (const r of rejected) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
console.log('\nrejections by rule:');
for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${reason}`);
}

const withText = rejected.filter(r => (r.job.description ?? '').length > 200);
console.log(`\n${withText.length} of ${rejected.length} have a usable description`);

if (!confirm) {
  console.log('\nDRY RUN: nothing written. Pass --confirm.');
  process.exit(0);
}

const stored = recordRejects(withText);
const stats = rejectStats();
console.log(`\nStored ${stored} new rows. rejected_jobs now holds ${stats.total} across ${stats.sources} sources.`);
