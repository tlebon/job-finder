#!/usr/bin/env tsx
/**
 * How much does the reviewer agree with itself?
 *
 * A stored verdict is one stochastic draw, not a fixed truth. The call sets no
 * temperature, so it runs at the default 1.0; jobs are judged five to a prompt,
 * so a verdict is conditioned on the four arbitrary neighbours it landed with;
 * and the excerpt is capped at 6,000 characters against a p90 of ~9,900.
 *
 * That matters for training a first-pass model on these labels. Self-agreement
 * is the reviewer's own reliability, and a model that learns the systematic part
 * of a noisy signal can beat any single draw of it - so this number is the real
 * headroom, not a ceiling.
 *
 * WRITES NOTHING. Re-reviewing and persisting would overwrite the very labels
 * being evaluated.
 *
 * Usage: npx tsx src/eval-reviewer-consistency.ts [--n=100]
 */

import { config } from 'dotenv';
import { db, getProfile } from './storage/db.js';
import { reviewCandidates } from './ai/reviewCandidates.js';
import type { Job } from './types.js';

config({ quiet: true });

const n = Number(process.argv.find(a => a.startsWith('--n='))?.split('=')[1] ?? 100);

const rows = db.prepare(`
  SELECT * FROM jobs
  WHERE ai_reviewed = 1 AND ai_suggestion IS NOT NULL
    AND description IS NOT NULL AND LENGTH(description) > 200
  ORDER BY RANDOM() LIMIT ?
`).all(n) as (Job & { ai_suggestion: string })[];

const original = new Map(rows.map(r => [r.id, r.ai_suggestion]));

const profile = getProfile();
if (!profile) { console.error('No profile stored.'); process.exit(1); }

console.log(`Re-reviewing ${rows.length} already-judged jobs. Nothing is written.\n`);

// Shuffled, so a job meets different neighbours than it did the first time -
// which is the point: batch context is one of the noise sources under test.
const shuffled = [...rows].sort(() => Math.random() - 0.5);
const results = await reviewCandidates(shuffled, profile);

const ORDER = ['STRONG_FIT', 'GOOD_FIT', 'MAYBE', 'AUTO_DISMISS'];
const idx = (s: string) => ORDER.indexOf(s);

let exact = 0, adjacent = 0, goodFlip = 0, compared = 0;
const matrix: Record<string, Record<string, number>> = {};

for (const r of results) {
  const before = original.get(r.jobId);
  if (!before) continue;
  compared++;
  matrix[before] = matrix[before] ?? {};
  matrix[before][r.suggestion] = (matrix[before][r.suggestion] ?? 0) + 1;

  if (before === r.suggestion) exact++;
  if (Math.abs(idx(before) - idx(r.suggestion)) <= 1) adjacent++;

  const wasGood = before === 'STRONG_FIT' || before === 'GOOD_FIT';
  const isGood = r.suggestion === 'STRONG_FIT' || r.suggestion === 'GOOD_FIT';
  if (wasGood !== isGood) goodFlip++;
}

const pct = (x: number) => `${((100 * x) / compared).toFixed(0)}%`;
console.log(`\ncompared:            ${compared}`);
console.log(`exact agreement:     ${pct(exact)}`);
console.log(`within one bucket:   ${pct(adjacent)}`);
console.log(`good/not-good flip:  ${pct(goodFlip)}   <- the decision a first-pass gate actually makes`);

console.log('\nfirst verdict (row) vs second (column):');
console.log(`${''.padEnd(14)}${ORDER.map(o => o.slice(0, 6).padStart(8)).join('')}`);
for (const before of ORDER) {
  const row = matrix[before] ?? {};
  const total = Object.values(row).reduce((a, b) => a + b, 0);
  if (!total) continue;
  console.log(`${before.padEnd(14)}${ORDER.map(o => String(row[o] ?? 0).padStart(8)).join('')}   (n=${total})`);
}
