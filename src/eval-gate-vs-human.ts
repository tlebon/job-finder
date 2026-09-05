#!/usr/bin/env tsx
/**
 * Score the gate against Tim's own labels.
 *
 * This is the only unbiased measurement in the project. Every other number
 * compares one thing to the AI reviewer, which agrees with itself half the
 * time, and is computed over jobs that already survived the gate.
 *
 * Rates are inverse-probability weighted by the sampling probability recorded
 * on each row. Strata were deliberately over-sampled where they were small, so
 * an unweighted rate would describe the sample rather than the job stream.
 *
 * Read-only. Usage: npx tsx src/eval-gate-vs-human.ts
 */

import { config } from 'dotenv';
import { db } from './storage/db.js';
import { filterJob } from './filters/jobFilter.js';
import type { RawJob } from './types.js';

config({ quiet: true });

interface Row {
  title: string; company: string; location: string; url: string;
  description: string; source: string;
  gate_passed: number; regex_score: number;
  sampling_prob: number; human_label: number;
}

const rows = db.prepare(`
  SELECT title, company, location, url, description, source,
         gate_passed, regex_score, sampling_prob, human_label
  FROM label_sample WHERE human_label IS NOT NULL AND stratum <> 'triage'
`).all() as Row[];

if (rows.length < 30) {
  console.log(`Only ${rows.length} labelled so far - too few to read anything into. Label more at /label`);
  process.exit(0);
}

/** Each sampled row stands for 1/p rows of the underlying stream. */
const w = (r: Row) => 1 / r.sampling_prob;
const sum = (rs: Row[]) => rs.reduce((a, r) => a + w(r), 0);

const yes = rows.filter(r => r.human_label === 1);
const no = rows.filter(r => r.human_label === 0);

console.log(`${rows.length} labelled (${yes.length} yes, ${no.length} no)`);
console.log(`weighted positive rate in the stream: ${(100 * sum(yes) / sum(rows)).toFixed(1)}%\n`);

// --- what the gate does -----------------------------------------------------

const keptYes = sum(yes.filter(r => r.gate_passed === 1));
const keptAll = sum(rows.filter(r => r.gate_passed === 1));
const recall = keptYes / sum(yes);
const keepRate = keptAll / sum(rows);
const precision = keptYes / keptAll;

console.log('=== the current regex gate ===');
console.log(`  recall     ${(100 * recall).toFixed(1)}%   of the jobs you would consider, it keeps this many`);
console.log(`  keep rate  ${(100 * keepRate).toFixed(1)}%   of everything fetched, it keeps this many`);
console.log(`  precision  ${(100 * precision).toFixed(1)}%   of what it keeps, this many are ones you'd consider`);
console.log(`  lost       ${yes.filter(r => r.gate_passed === 0).length} of ${yes.length} sampled yes-jobs\n`);

// --- what the score buys on top ---------------------------------------------
// The gate is a filter and the score a ranker, and they answer different
// questions. This is the ranker: sort everything fetched by regex score and ask
// how much has to be kept to retain a given share of the yes-jobs.

const scored = rows.map(r => ({ ...r, fresh: filterJob(r as unknown as RawJob).score }))
  .sort((a, b) => b.fresh - a.fresh);

const totalYes = sum(yes);
const totalAll = sum(rows);

console.log('=== ranking by regex score: recall against how much you keep ===');
console.log('  keep    recall');
let acc = 0, accYes = 0;
const marks = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.75];
let next = 0;
for (const r of scored) {
  acc += w(r);
  if (r.human_label === 1) accYes += w(r);
  while (next < marks.length && acc / totalAll >= marks[next]) {
    console.log(`  ${(100 * marks[next]).toFixed(0).padStart(3)}%   ${(100 * accYes / totalYes).toFixed(1).padStart(5)}%`);
    next++;
  }
}

// AUC against human labels, ties counted half - the honest version of the
// number every earlier measurement approximated using reviewer verdicts.
let wins = 0, pairs = 0;
for (const p of yes) for (const n of no) {
  const a = filterJob(p as unknown as RawJob).score;
  const b = filterJob(n as unknown as RawJob).score;
  wins += a > b ? 1 : a === b ? 0.5 : 0;
  pairs++;
}
console.log(`\nAUC of the regex score against your labels: ${(wins / pairs).toFixed(3)}   (0.50 = coin flip)`);
console.log(`(unweighted, ${yes.length}x${no.length} pairs - treat as indicative, not precise)`);
