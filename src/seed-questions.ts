#!/usr/bin/env tsx
/**
 * Seed the question bank from the forms Tim actually pasted.
 *
 * The bank was shipped empty, which was a silly place to leave it: six real
 * forms went into designing it and every one of them is a source of real
 * questions. Seeding means the first thing he sees is a list to answer rather
 * than an empty page, and answers written now are ready before the seventh
 * application rather than after it.
 *
 * Deduplicated on the normalised key, so "Why Granola?", "Why METR?" and "Why
 * do you want to work for Zyphra?" collapse into one question to answer once -
 * which is the entire point.
 *
 * Usage:
 *   npx tsx src/seed-questions.ts --dry-run
 *   npx tsx src/seed-questions.ts --confirm
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { parseForm, detectAts } from './questions/parseForm.js';
import { saveQuestion } from './storage/questions.js';
import { normalizeQuestion } from './storage/chunks.js';
import { db } from './storage/db.js';
import { initChunkStore } from './storage/chunks.js';

config({ quiet: true });

// The store is built lazily by saveQuestion, and the duplicate check below
// queries the table before anything has saved to it.
initChunkStore();

const confirm = process.argv.includes('--confirm');
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'questions', '__fixtures__');

/** Company from the fixture name: "granola-ashby.txt" -> Granola. */
const companyOf = (file: string) => {
  const name = file.replace(/\.txt$/, '').split('-')[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
};

interface Seed {
  question: string; kind: string; company: string; ats: string; lengthLimit?: string;
}

const seen = new Map<string, Seed>();
let total = 0;

for (const file of readdirSync(dir).filter(f => f.endsWith('.txt'))) {
  const text = readFileSync(join(dir, file), 'utf8');
  const ats = detectAts(text);
  const company = companyOf(file);

  for (const field of parseForm(text)) {
    // Mechanical fields are answered from memory in seconds and the browser
    // autofills most of them. Recording them here would bury the six that
    // actually cost something.
    if (field.kind === 'mechanical') continue;
    total++;
    // Company included: two companies asking "why us" are two questions with
    // two answers. Collapsing them would have meant answering one and never
    // seeing the others.
    const key = normalizeQuestion(field.question);
    // First sighting wins, so the earliest company is credited and later
    // phrasings of the same question do not create duplicates.
    if (!seen.has(key)) {
      seen.set(key, { question: field.question, kind: field.kind, company, ats, lengthLimit: field.lengthLimit });
    }
  }
}

console.log(`${total} non-mechanical fields across ${readdirSync(dir).filter(f => f.endsWith('.txt')).length} forms`);
console.log(`${seen.size} distinct questions (exact repeats collapsed; company-specific ones kept apart)\n`);

const existing = new Set(
  (db.prepare('SELECT normalized_key FROM application_questions').all() as { normalized_key: string }[])
    .map(r => r.normalized_key)
);

const fresh = [...seen.entries()].filter(([key]) => !existing.has(key));
console.log(`${fresh.length} not already in the bank:\n`);
for (const [, s] of fresh) {
  console.log(`  [${s.kind.padEnd(8)}] ${s.question.slice(0, 68)}${s.lengthLimit ? `  <${s.lengthLimit}>` : ''}`);
}

if (!confirm) {
  console.log('\nDRY RUN: pass --confirm to seed.');
  process.exit(0);
}

for (const [, s] of fresh) {
  saveQuestion({
    questionText: s.question,
    kind: s.kind as 'prose' | 'decision',
    company: s.company,
    ats: s.ats as never,
    lengthLimit: s.lengthLimit,
  });
}
console.log(`\nSeeded ${fresh.length} questions. Answer them at /questions`);
