/**
 * Parity with scikit-learn.
 *
 * fixture.json holds 200 postings scored in Python by the same fitted model.
 * Production has no labels, so a tokenisation difference would degrade the
 * ranking silently and permanently; this is the only thing that would catch it.
 *
 * Regenerate both together: ml/.venv/bin/python ml/export_model.py
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreJob, tokenize } from './score.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixture.json'), 'utf8')) as {
  title: string; text: string; source: string; score: number;
}[];

test('scores match scikit-learn to 1e-6 across the fixture', () => {
  let worst = 0;
  let worstRow = '';
  for (const row of fixture) {
    const got = scoreJob({ title: row.title, description: row.text, source: row.source });
    const diff = Math.abs(got.probability - row.score);
    if (diff > worst) { worst = diff; worstRow = row.title; }
  }
  assert.ok(worst < 1e-6, `largest disagreement ${worst.toExponential(2)} on "${worstRow}"`);
});

test('tokenisation drops single characters, as sklearn does', () => {
  // token_pattern (?u)\b\w\w+\b requires two or more word characters.
  assert.deepEqual(tokenize('a ML engineer', 1), ['ml', 'engineer']);
});

test('bigrams are emitted in order alongside unigrams', () => {
  assert.deepEqual(tokenize('machine learning engineer', 2),
    ['machine', 'learning', 'engineer', 'machine learning', 'learning engineer']);
});

test('an unseen source contributes nothing rather than throwing', () => {
  const a = scoreJob({ title: 'Machine Learning Engineer', description: 'PyTorch.', source: 'nonexistent' });
  assert.ok(Number.isFinite(a.probability));
  assert.ok(a.probability > 0 && a.probability < 1);
});
