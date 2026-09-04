#!/usr/bin/env tsx
/**
 * Does the pipeline surface the jobs Tim picked himself?
 *
 * data/shortlist.json holds companies he had open in his browser - jobs he chose
 * without the tool's help. They are the only ground-truth positives here. The AI
 * reviewer agrees with its own earlier verdict about half the time, so its
 * verdicts measure consistency, not correctness; these measure correctness.
 *
 * Read-only. Run it after any change to sources or filters; a change that
 * improves an AUC against reviewer labels but drops coverage here made things
 * worse.
 *
 * Usage: npx tsx src/eval-shortlist.ts
 */

import { readFileSync } from 'node:fs';
import { config } from 'dotenv';
import { db } from './storage/db.js';

config({ quiet: true });

interface Entry { company: string; role: string | null; via: string }

const { entries } = JSON.parse(readFileSync('data/shortlist.json', 'utf8')) as { entries: Entry[] };

const find = db.prepare(`
  SELECT title, company, source, status, score, ai_suggestion
  FROM jobs WHERE company LIKE ? COLLATE NOCASE
  ORDER BY score DESC
`);

let present = 0, active = 0, endorsed = 0;

for (const e of entries) {
  const rows = find.all(`%${e.company}%`) as {
    title: string; company: string; source: string;
    status: string; score: number; ai_suggestion: string | null;
  }[];

  // Same-name-different-company is a live hazard here: a LIKE on 'METR' also
  // matches Metrea, Metrikflow, Altimetrik and Symmetry Systems, which once led
  // to a whole fabricated story about METR being archived.
  const exact = rows.filter(r => r.company.toLowerCase().trim() === e.company.toLowerCase());
  const use = exact.length ? exact : rows;

  const label = `${e.company}${e.role ? ` (${e.role})` : ''}`.padEnd(34);

  if (!use.length) {
    console.log(`  MISSING  ${label} - never fetched, via ${e.via}`);
    continue;
  }
  present++;

  const live = use.filter(r => !['NOT_FIT', 'ARCHIVED'].includes(r.status));
  if (live.length) active++;
  const best = (live.length ? live : use)[0];
  if (best.ai_suggestion === 'STRONG_FIT' || best.ai_suggestion === 'GOOD_FIT') endorsed++;

  const state = live.length ? 'PRESENT' : 'BURIED ';
  const fuzzy = exact.length ? '' : `  [name match only: "${best.company}"]`;
  console.log(`  ${state}  ${label} ${String(best.score).padStart(4)}  ${(best.ai_suggestion ?? 'unreviewed').padEnd(12)} ${use.length} listing(s) via ${best.source}${fuzzy}`);
}

const n = entries.length;
console.log(`\nfetched at all:        ${present}/${n}`);
console.log(`visible (not buried):  ${active}/${n}`);
console.log(`endorsed strong/good:  ${endorsed}/${n}`);
