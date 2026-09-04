/**
 * The human-labelled evaluation set.
 *
 * Kept apart from the jobs table on purpose. Every row in `jobs` is a survivor
 * of the regex gate - filterJobs discards the rest before storage - so a model
 * trained and scored on `jobs` is measured on a population it will never meet
 * in production. This table holds a sample drawn *before* the gate, so it
 * contains the rejects too.
 *
 * Rows carry the stratum they were drawn from and the probability they were
 * drawn with, so estimates can be inverse-probability weighted back to the raw
 * stream. Without that, over-sampling the small strata quietly biases every
 * rate computed from the set.
 *
 * gate_passed and regex_score are stored but must never reach the labelling UI.
 * A label produced while looking at the gate's opinion is not independent of it,
 * and this set exists precisely to judge the gate.
 */

import { db } from './db.js';

export interface LabelRow {
  id: string;
  source: string;
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  gate_passed: number;
  regex_score: number;
  stratum: string;
  sampling_prob: number;
  stratum_size: number;
  human_label: number | null;
  labelled_at: string | null;
  display_order: number;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS label_sample (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT NOT NULL,
    description TEXT NOT NULL,
    url TEXT NOT NULL,
    gate_passed INTEGER NOT NULL,
    regex_score INTEGER NOT NULL,
    stratum TEXT NOT NULL,
    sampling_prob REAL NOT NULL,
    stratum_size INTEGER NOT NULL,
    human_label INTEGER,
    labelled_at TEXT,
    display_order INTEGER NOT NULL
  )
`);

export function insertLabelRows(rows: Omit<LabelRow, 'human_label' | 'labelled_at'>[]): number {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO label_sample
      (id, created_at, source, title, company, location, description, url,
       gate_passed, regex_score, stratum, sampling_prob, stratum_size, display_order)
    VALUES (@id, @created_at, @source, @title, @company, @location, @description, @url,
            @gate_passed, @regex_score, @stratum, @sampling_prob, @stratum_size, @display_order)
  `);
  const now = new Date().toISOString();
  const run = db.transaction((batch: typeof rows) => {
    let n = 0;
    for (const r of batch) n += stmt.run({ ...r, created_at: now }).changes;
    return n;
  });
  return run(rows);
}

// Verdicts for the labelling set, kept on the row itself.
//
// The comparison that matters is all three scorers on the *same* rows. Only 63
// of 175 labelled rows carry a reviewer verdict, because a verdict only exists
// for jobs the gate kept and stored - so the reviewer's apparent performance is
// measured on the subset the regex already liked. That is the same range
// restriction that produced two wrong answers earlier today.
for (const column of ['ai_suggestion TEXT', 'ai_reasoning TEXT', 'ai_score_adjustment INTEGER', 'model_score REAL']) {
  try {
    db.exec(`ALTER TABLE label_sample ADD COLUMN ${column}`);
  } catch {
    // Column already exists
  }
}

export function labelProgress(): { total: number; labelled: number } {
  const r = db.prepare(`
    SELECT COUNT(*) total, SUM(human_label IS NOT NULL) labelled FROM label_sample
  `).get() as { total: number; labelled: number | null };
  return { total: r.total, labelled: r.labelled ?? 0 };
}
