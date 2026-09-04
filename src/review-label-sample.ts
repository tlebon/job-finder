#!/usr/bin/env tsx
/**
 * Give every row in the labelling set a reviewer verdict.
 *
 * Only the rows the gate kept were ever stored in `jobs`, so only those carry
 * an ai_suggestion - 63 of 175 labelled. Measuring the reviewer on that subset
 * measures it on jobs the regex already liked, which is the range restriction
 * that produced two wrong answers earlier today.
 *
 * Writes to label_sample only; the jobs table is untouched, and rejected rows
 * do not enter it.
 *
 * Usage: npx tsx src/review-label-sample.ts --confirm [--limit=200]
 */

import { config } from 'dotenv';
import { db, getProfile } from './storage/db.js';
import { reviewCandidates } from './ai/reviewCandidates.js';
import type { Job } from './types.js';

config({ quiet: true });

const limit = Number(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? 400);
const confirm = process.argv.includes('--confirm');

const rows = db.prepare(`
  SELECT id, title, company, location, description, url, source
  FROM label_sample
  WHERE ai_suggestion IS NULL
  ORDER BY human_label IS NULL, display_order
  LIMIT ?
`).all(limit) as Job[];

console.log(`${rows.length} sample rows without a reviewer verdict (labelled ones first)`);
if (!rows.length || !confirm) {
  if (!confirm) console.log('DRY RUN: pass --confirm.');
  process.exit(0);
}

const profile = getProfile();
if (!profile) { console.error('No profile stored.'); process.exit(1); }

const save = db.prepare(`
  UPDATE label_sample SET ai_suggestion = ?, ai_reasoning = ?, ai_score_adjustment = ?
  WHERE id = ?
`);

const CHUNK = 20;
const tally: Record<string, number> = {};
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  const results = await reviewCandidates(chunk, profile);
  for (const r of results) {
    save.run(r.suggestion, r.reasoning, r.scoreAdjustment, r.jobId);
    tally[r.suggestion] = (tally[r.suggestion] ?? 0) + 1;
  }
  console.log(`  ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
}
console.log('\n' + Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', '));
