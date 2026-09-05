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

console.log(`\n${'model'.padEnd(34)}${'recall'.padStart(8)}${'precision'.padStart(11)}${'agree'.padStart(8)}`);
for (const model of models) {
  process.env.REVIEW_MODEL = model;
  const results = await reviewCandidates(rows, profile);

  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of results) {
    const want = wants.get(r.jobId);
    if (want === undefined) continue;
    const said = good(r.suggestion);
    if (want && said) tp++; else if (!want && said) fp++; else if (want && !said) fn++; else tn++;
  }
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');
  console.log(
    model.padEnd(34) +
    pct(tp, tp + fn).padStart(8) +
    pct(tp, tp + fp).padStart(11) +
    pct(tp + tn, tp + fp + fn + tn).padStart(8)
  );
}
