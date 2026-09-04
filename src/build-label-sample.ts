#!/usr/bin/env tsx
/**
 * Draw a pre-gate sample for Tim to label by hand.
 *
 * Fetches every source, partitions on filterJob(), and samples across
 * source x gate-passed strata. The rejects are the point: they are never
 * stored otherwise, so nothing in the database can tell us what the gate loses.
 *
 * Allocation is proportional to stratum size with a floor, so a small stratum
 * still gets looked at, and each row records the probability it was drawn with
 * so estimates can be weighted back to the raw stream afterwards.
 *
 * Usage:
 *   npx tsx src/build-label-sample.ts --dry-run
 *   npx tsx src/build-label-sample.ts --confirm [--target=300] [--floor=8]
 */

import { createHash } from 'node:crypto';
import { config } from 'dotenv';
import { fetchAllJobs } from './sources/index.js';
import { filterJob } from './filters/jobFilter.js';
import { cleanJobDescription } from './utils/jobText.js';
import { insertLabelRows, labelProgress } from './storage/labelSample.js';
import type { RawJob } from './types.js';

config({ quiet: true });

const arg = (n: string, d: number) =>
  Number(process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1] ?? d);

const target = arg('target', 300);
const floor = arg('floor', 8);
const confirm = process.argv.includes('--confirm');

console.log('Fetching all sources...');
const all = await fetchAllJobs();

interface Candidate { job: RawJob; passed: boolean; score: number; stratum: string }

const seen = new Set<string>();
const strata = new Map<string, Candidate[]>();

for (const job of all) {
  if (!job.url || seen.has(job.url)) continue;
  if (!job.description || job.description.length < 200) continue;
  seen.add(job.url);

  const r = filterJob(job);
  const stratum = `${job.source}|${r.passed ? 'pass' : 'reject'}`;
  if (!strata.has(stratum)) strata.set(stratum, []);
  strata.get(stratum)!.push({ job, passed: r.passed, score: r.score, stratum });
}

const population = [...strata.values()].reduce((a, v) => a + v.length, 0);
console.log(`\n${population} unique postings with a usable description\n`);

// Proportional allocation with a floor, then scaled back to the target so the
// floor does not quietly inflate the total.
const sizes = [...strata.entries()].map(([k, v]) => [k, v.length] as const);
const raw = sizes.map(([k, n]) => [k, Math.max(floor, Math.round((n / population) * target))] as const);
const rawTotal = raw.reduce((a, [, n]) => a + n, 0);
const alloc = new Map(raw.map(([k, n]) => [k, Math.min(
  strata.get(k)!.length,
  Math.max(1, Math.round(n * (target / rawTotal)))
)]));

console.log('stratum'.padEnd(28) + 'population'.padStart(11) + 'sampled'.padStart(9) + '     p(draw)');
const picked: Parameters<typeof insertLabelRows>[0] = [];

for (const [stratum, pool] of strata) {
  const take = alloc.get(stratum)!;
  const prob = take / pool.length;
  console.log(stratum.padEnd(28) + String(pool.length).padStart(11) + String(take).padStart(9) + `     ${prob.toFixed(3)}`);

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  for (const c of shuffled.slice(0, take)) {
    picked.push({
      // Hashed, not truncated. This was base64 of the URL cut to 40 characters,
      // and every Greenhouse or Ashby posting shares that prefix - so INSERT OR
      // IGNORE silently collapsed 291 sampled rows into 41, leaving a subset
      // that was no longer the stratified draw it reported being.
      id: `ls_${createHash('sha1').update(c.job.url).digest('hex').slice(0, 24)}`,
      source: c.job.source,
      title: c.job.title,
      company: c.job.company,
      location: c.job.location || 'Not stated',
      description: cleanJobDescription(c.job.description),
      url: c.job.url,
      gate_passed: c.passed ? 1 : 0,
      regex_score: c.score,
      stratum,
      sampling_prob: prob,
      stratum_size: pool.length,
      display_order: 0,
    });
  }
}

// One shuffle across the whole sample, so the labelling order carries no
// information about stratum, source or the gate's opinion.
const order = [...picked].sort(() => Math.random() - 0.5);
order.forEach((row, i) => { row.display_order = i; });

console.log(`\nTotal to label: ${picked.length}`);
console.log(`  gate passed:  ${picked.filter(p => p.gate_passed === 1).length}`);
console.log(`  gate rejected:${picked.filter(p => p.gate_passed === 0).length}`);

if (!confirm) {
  console.log('\nDRY RUN: pass --confirm to write the sample.');
  process.exit(0);
}

const inserted = insertLabelRows(picked);
const p = labelProgress();
console.log(`\nInserted ${inserted} rows. Sample now ${p.labelled}/${p.total} labelled.`);
console.log('Label them at /label');
