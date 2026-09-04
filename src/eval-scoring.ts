#!/usr/bin/env tsx
/**
 * Does the score actually rank?
 *
 * Recomputes filterJob() over every AI-reviewed job and measures how well the
 * resulting score separates the verdicts. Read-only: it writes nothing.
 *
 * Read the output with the ceiling in mind. The labels are one model's opinion
 * generated from the stored profile, not outcomes, so a better number here
 * means "agrees more closely with the reviewer", never "finds better jobs".
 * Real ground truth is applications and replies, which is what APPLIED-status
 * jobs would eventually give us.
 *
 * The headline number is AUC: the chance that a randomly chosen strong-or-good
 * job outscores a randomly chosen auto-dismissed one. 0.50 is a coin flip.
 *
 * Isolate one change at a time with the scoring toggles, since several shipped
 * together and a single AUC cannot attribute a drop to any of them:
 *
 *   SCORING_FLAT_WEIGHTS=1           score every category alike (pre-weighting)
 *   SCORING_BOILERPLATE_DISCOUNT=1   trust description-only evidence fully
 *
 * Usage: npx tsx src/eval-scoring.ts
 */

import { config } from 'dotenv';
import { db } from './storage/db.js';
import { filterJob } from './filters/jobFilter.js';
import type { RawJob } from './types.js';

config({ quiet: true });

interface Row {
  title: string; company: string; location: string; url: string;
  description: string; source: string;
  ai_suggestion: string; score: number; ai_score_adjustment: number | null;
}

// Every labelled job. The leak is in the *stored* score - where the adjustment
// was never recorded separately it is still baked into the number, so the
// verdict leaks into anything evaluated against that verdict. It does not touch
// the freshly recomputed score, which comes from raw text and carries no
// adjustment at all. Restricting both columns needlessly threw away more than
// half the rows from the honest baseline.
const rows = db.prepare(`
  SELECT title, company, location, url, description, source,
         ai_suggestion, score, ai_score_adjustment
  FROM jobs
  WHERE ai_reviewed = 1 AND ai_suggestion IS NOT NULL
`).all() as Row[];

const leaked = db.prepare(`
  SELECT COUNT(*) c FROM jobs
  WHERE ai_reviewed = 1 AND ai_suggestion IS NOT NULL AND ai_score_adjustment IS NULL
`).get() as { c: number };
if (leaked.c) console.log(`(excluding ${leaked.c} jobs whose stored score has the adjustment baked in)`);

console.log(`${rows.length} AI-reviewed jobs\n`);

const scored = rows.map(r => ({
  verdict: r.ai_suggestion,
  stored: r.score - (r.ai_score_adjustment ?? 0),
  hasAdjustment: r.ai_score_adjustment !== null,
  fresh: filterJob(r as unknown as RawJob).score,
}));

const good = (v: string) => v === 'STRONG_FIT' || v === 'GOOD_FIT';

/**
 * Probability a random good job outscores a random not-good one; ties count half.
 *
 * "Not good" is everything else, MAYBE included. This previously compared good
 * against AUTO_DISMISS alone, dropping MAYBE entirely - an easier problem than
 * the one a gate faces, and a different one from what any model trained on a
 * binary good/not-good column would be scored on. The two numbers were not
 * comparable.
 */
function auc(pick: (s: typeof scored[number]) => number, set = scored): number {
  const pos = set.filter(s => good(s.verdict)).map(pick);
  const neg = set.filter(s => !good(s.verdict)).map(pick);
  if (!pos.length || !neg.length) return NaN;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

function quantiles(values: number[]): string {
  const v = [...values].sort((a, b) => a - b);
  const q = (p: number) => v[Math.floor(p * (v.length - 1))];
  return `n=${String(v.length).padStart(4)}  p25 ${String(q(0.25)).padStart(4)}  median ${String(q(0.5)).padStart(4)}  p75 ${String(q(0.75)).padStart(4)}`;
}

// The stored column is only meaningful where the adjustment was recorded.
const cleanStored = scored.filter(s => s.hasAdjustment);
console.log(`stored-score baseline uses ${cleanStored.length} rows with a recoverable base score\n`);

for (const [label, pick] of [
  ['stored (score as it sits in the database)', (s: typeof scored[number]) => s.stored],
  ['fresh  (recomputed with current code)   ', (s: typeof scored[number]) => s.fresh],
] as const) {
  const set = label.startsWith('stored') ? cleanStored : scored;
  console.log(`--- ${label} (n=${set.length}) ---`);
  for (const v of ['STRONG_FIT', 'GOOD_FIT', 'MAYBE', 'AUTO_DISMISS']) {
    const vals = set.filter(s => s.verdict === v).map(pick);
    if (vals.length) console.log(`  ${v.padEnd(13)} ${quantiles(vals)}`);
  }
  console.log(`  AUC good-vs-rest: ${auc(pick, set).toFixed(3)}   (0.50 = coin flip)\n`);
}

// The distinction that actually matters when reading the list: is the job worth
// opening? Separating strong from merely-maybe is where the score was useless.
const strongVsMaybe = (pick: (s: typeof scored[number]) => number) => {
  const pos = scored.filter(s => s.verdict === 'STRONG_FIT').map(pick);
  const neg = scored.filter(s => s.verdict === 'MAYBE').map(pick);
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
};
console.log('--- strong vs maybe (the hard distinction) ---');
console.log(`  stored AUC: ${strongVsMaybe(s => s.stored).toFixed(3)}`);
console.log(`  fresh  AUC: ${strongVsMaybe(s => s.fresh).toFixed(3)}`);
