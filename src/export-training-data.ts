#!/usr/bin/env tsx
/**
 * Export labelled jobs for offline model training.
 *
 * Emits JSONL on stdout so it can be piped or gzipped straight off the
 * production box. Read-only.
 *
 * The company name is exported in its own field and deliberately kept out of
 * the text field. Training on raw descriptions teaches the model to recognise
 * the employer - Anthropic alone is 310 postings - which is this project's
 * signature bug wearing a new hat, and it inflates any score computed on a
 * random split.
 *
 * Usage: npx tsx src/export-training-data.ts > train.jsonl
 */

import { config } from 'dotenv';
import { db } from './storage/db.js';
import { excerptForReview } from './utils/jobText.js';

config({ quiet: true });

interface Row {
  title: string; company: string; location: string; source: string;
  description: string; ai_suggestion: string; status: string;
  status_source: string | null; score: number; ai_score_adjustment: number | null;
}

const rows = db.prepare(`
  SELECT title, company, location, source, description,
         ai_suggestion, status, status_source, score, ai_score_adjustment
  FROM jobs
  WHERE ai_suggestion IS NOT NULL
    AND description IS NOT NULL AND LENGTH(description) > 200
`).all() as Row[];

for (const r of rows) {
  // Trimmed to the part that describes the role. Full descriptions run to a p90
  // of ~9,900 characters, which makes the export unwieldy to move and adds
  // mostly company boilerplate.
  const text = excerptForReview(r.description, 2000);

  process.stdout.write(JSON.stringify({
    title: r.title,
    company: r.company,
    location: r.location,
    source: r.source,
    text,
    label: r.ai_suggestion,
    good: r.ai_suggestion === 'STRONG_FIT' || r.ai_suggestion === 'GOOD_FIT' ? 1 : 0,
    status: r.status,
    // 'user' marks a human decision. Rare for now - the column was only added
    // today - but these are the only labels that are ground truth.
    status_source: r.status_source,
    regex_score: r.ai_score_adjustment === null ? null : r.score - r.ai_score_adjustment,
  }) + '\n');
}
