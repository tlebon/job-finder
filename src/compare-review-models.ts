#!/usr/bin/env tsx
/**
 * Does the cheaper model review as well?
 *
 * Review is classification against a fixed rubric, not open reasoning, so the
 * tier may not matter - but that is a measurable question and Tim has 480 hand
 * labels to settle it with. Agreement with him is the only thing worth
 * comparing; agreement between the two models says nothing about correctness.
 *
 * Reads the dev-set rows only. The 200 held-out rows stay untouched.
 *
 * Usage: npx tsx src/compare-review-models.ts --confirm [--limit=120]
 */

import { config } from 'dotenv';
import { db, getProfile } from './storage/db.js';
import { reviewCandidates } from './ai/reviewCandidates.js';
import type { Job } from './types.js';

config({ quiet: true });

const limit = Number(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? 120);
const models = (process.argv.find(a => a.startsWith('--models='))?.split('=')[1]
  ?? 'claude-sonnet-4-5-20250929,claude-haiku-4-5-20251001').split(',');

const rows = db.prepare(`
  SELECT id, title, company, location, description, url, source, human_label
  FROM label_sample
  WHERE human_label IS NOT NULL AND display_order < 281
  ORDER BY display_order LIMIT ?
`).all(limit) as (Job & { human_label: number })[];

console.log(`${rows.length} dev-set rows, ${rows.filter(r => r.human_label === 1).length} of them jobs Tim wants`);
if (!process.argv.includes('--confirm')) {
  console.log(`Would run: ${models.join(', ')}\nDRY RUN: pass --confirm.`);
  process.exit(0);
}

const profile = getProfile();
if (!profile) { console.error('No profile stored.'); process.exit(1); }

const good = (s: string) => s === 'STRONG_FIT' || s === 'GOOD_FIT';
const wants = new Map(rows.map(r => [r.id, r.human_label === 1]));

// Per-model verdicts kept, not just tallies. Two models can each get 18 of 27
// right while disagreeing about which 18 - a comparison of counts alone cannot
// tell those apart, and counts alone are what an earlier version reported.
const verdicts = new Map<string, Map<string, boolean>>();

console.log(`\n${'model'.padEnd(34)}${'recall'.padStart(8)}${'precision'.padStart(11)}${'agree'.padStart(8)}`);
for (const model of models) {
  process.env.REVIEW_MODEL = model;
  const results = await reviewCandidates(rows, profile);

  const said = new Map<string, boolean>();
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of results) {
    const want = wants.get(r.jobId);
    if (want === undefined) continue;
    const yes = good(r.suggestion);
    said.set(r.jobId, yes);
    if (want && yes) tp++; else if (!want && yes) fp++; else if (want && !yes) fn++; else tn++;
  }
  verdicts.set(model, said);

  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');
  console.log(
    model.padEnd(34) +
    pct(tp, tp + fn).padStart(8) +
    pct(tp, tp + fp).padStart(11) +
    pct(tp + tn, tp + fp + fn + tn).padStart(8)
  );
}

if (models.length === 2) {
  const [a, b] = models.map(m => verdicts.get(m)!);
  const shared = [...a.keys()].filter(id => b.has(id));
  const same = shared.filter(id => a.get(id) === b.get(id)).length;
  console.log(`\nthe two models made the same call on ${same} of ${shared.length} jobs ` +
    `(${Math.round((100 * same) / Math.max(1, shared.length))}%)`);

  const disagreed = shared.filter(id => a.get(id) !== b.get(id));
  if (disagreed.length) {
    const byId = new Map(rows.map(r => [r.id, r]));
    console.log('\nwhere they differed, and who was right:');
    for (const id of disagreed.slice(0, 12)) {
      const job = byId.get(id);
      const truth = wants.get(id) ? 'Tim: yes' : 'Tim: no ';
      console.log(`  ${truth}  ${models[0].includes('sonnet') ? 'sonnet' : models[0].slice(7, 13)}=${a.get(id) ? 'yes' : 'no '}` +
        `  haiku=${b.get(id) ? 'yes' : 'no '}  ${(job?.title ?? '').slice(0, 44)}`);
    }
  }
}
