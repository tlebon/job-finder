#!/usr/bin/env tsx
/**
 * How many good jobs does the regex gate throw away?
 *
 * Every number measured so far concerns jobs that already passed the filter,
 * because a rejected job is never stored - filterJobs counts it and drops it, so
 * appendJobs only ever sees survivors. The rejects therefore cannot be sampled
 * from the database; they have to be caught during a live fetch.
 *
 * This fetches every source, partitions on filterJob(), samples the rejects by
 * the rule that killed them, and sends the sample to the same reviewer the
 * survivors get. A reject coming back STRONG_FIT or GOOD_FIT is a job the gate
 * cost you, and grouping by rule says which rule to loosen.
 *
 * WRITES NOTHING to the jobs table.
 *
 * Usage: npx tsx src/eval-gate-recall.ts [--per-reason=12] [--max=150]
 */

import { config } from 'dotenv';
import { fetchAllJobs } from './sources/index.js';
import { filterJob } from './filters/jobFilter.js';
import { getProfile, rawJobToJob } from './storage/db.js';
import { reviewCandidates } from './ai/reviewCandidates.js';
import type { RawJob } from './types.js';

config({ quiet: true });

const arg = (name: string, fallback: number) =>
  Number(process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);

const perReason = arg('per-reason', 12);
const max = arg('max', 150);

/** The rule that killed it, normalised so near-identical reasons group. */
function rejectionReason(criteria: string[]): string {
  const excluded = criteria.find(c => c.startsWith('EXCLUDED'));
  if (!excluded) return 'no pass rule met';
  return excluded
    .replace(/\s*\(.*\)\s*$/, '')      // drop the specific matched term
    .replace(/^EXCLUDED:\s*/, '')
    .trim();
}

console.log('Fetching all sources...');
const all = await fetchAllJobs();

const seen = new Set<string>();
const rejects = new Map<string, RawJob[]>();
let passed = 0;

for (const job of all) {
  if (seen.has(job.url)) continue;
  seen.add(job.url);

  const r = filterJob(job);
  if (r.passed) { passed++; continue; }

  const reason = rejectionReason(r.matchedCriteria);
  if (!rejects.has(reason)) rejects.set(reason, []);
  rejects.get(reason)!.push(job);
}

const totalRejected = [...rejects.values()].reduce((a, v) => a + v.length, 0);
console.log(`\n${seen.size} unique jobs fetched: ${passed} passed, ${totalRejected} rejected\n`);

const bySize = [...rejects.entries()].sort((a, b) => b[1].length - a[1].length);
console.log('Rejections by rule:');
for (const [reason, jobs] of bySize) {
  console.log(`  ${String(jobs.length).padStart(5)}  ${reason}`);
}

// Sample per rule rather than uniformly: a rule rejecting 40 jobs can still be
// the one costing the most, and a uniform sample would never test it.
const sample: { job: RawJob; reason: string }[] = [];
for (const [reason, jobs] of bySize) {
  const shuffled = [...jobs].sort(() => Math.random() - 0.5);
  for (const job of shuffled.slice(0, perReason)) sample.push({ job, reason });
}
const capped = sample.slice(0, max);

console.log(`\nReviewing ${capped.length} rejected jobs, up to ${perReason} per rule...\n`);

const profile = getProfile();
if (!profile) { console.error('No profile stored.'); process.exit(1); }

const jobs = capped.map(s => rawJobToJob(s.job));
const reasonById = new Map(jobs.map((j, i) => [j.id, capped[i].reason]));
const results = await reviewCandidates(jobs, profile);

const tally = new Map<string, { n: number; good: number; titles: string[] }>();
for (const r of results) {
  const reason = reasonById.get(r.jobId) ?? 'unknown';
  const t = tally.get(reason) ?? { n: 0, good: 0, titles: [] };
  t.n++;
  if (r.suggestion === 'STRONG_FIT' || r.suggestion === 'GOOD_FIT') {
    t.good++;
    const j = jobs.find(x => x.id === r.jobId);
    if (j) t.titles.push(`[${r.suggestion === 'STRONG_FIT' ? 'STRONG' : 'good'}] ${j.title} @ ${j.company}`);
  }
  tally.set(reason, t);
}

console.log('\n=== what each rule costs ===');
console.log(`${'rule'.padEnd(42)}${'sampled'.padStart(8)}${'good'.padStart(6)}${'rate'.padStart(7)}${'est. lost'.padStart(11)}`);
let estimatedLoss = 0;
for (const [reason, jobs_] of bySize) {
  const t = tally.get(reason);
  if (!t || !t.n) continue;
  const rate = t.good / t.n;
  const est = Math.round(rate * jobs_.length);
  estimatedLoss += est;
  console.log(`${reason.slice(0, 41).padEnd(42)}${String(t.n).padStart(8)}${String(t.good).padStart(6)}${(100 * rate).toFixed(0).padStart(6)}%${String(est).padStart(11)}`);
}
console.log(`\nEstimated good jobs discarded per fetch: ~${estimatedLoss} of ${totalRejected} rejected`);

console.log('\n=== good jobs the gate rejected ===');
for (const [reason, t] of tally) {
  if (!t.titles.length) continue;
  console.log(`\n${reason}:`);
  t.titles.slice(0, 8).forEach(x => console.log(`  ${x}`));
}
