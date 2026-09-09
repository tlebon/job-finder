/**
 * Parity with ml/features.py.
 *
 * This is the second implementation of one extractor, which is the reason the
 * structured features were kept out of the shipped model for so long: two
 * copies drift, and production has no labels to notice. The fixture carries
 * Python's own feature vector for 200 real postings, so a divergence fails here
 * and names the feature rather than showing up as a slow, invisible decline in
 * ranking quality.
 *
 * Regenerate with: ml/.venv/bin/python ml/export_model.py
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract } from './features.js';
import { loadModel } from './score.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixture.json'), 'utf8')) as {
  title: string; text: string; source: string; location: string; features: number[];
}[];

test('every structured feature matches Python across the fixture', () => {
  const names = loadModel().struct.names;
  const worst = new Map<string, number>();

  for (const row of fixture) {
    const got = extract(row.title, row.text, row.location);
    names.forEach((name, i) => {
      const diff = Math.abs(got[name] - row.features[i]);
      if (diff > (worst.get(name) ?? 0)) worst.set(name, diff);
    });
  }

  const drifted = [...worst.entries()].filter(([, d]) => d > 1e-9);
  assert.deepEqual(
    drifted, [],
    `features disagree with Python: ${drifted.map(([n, d]) => `${n} by ${d}`).join(", ")}`,
  );
});

test('the feature order in the model matches what extract produces', () => {
  const names = loadModel().struct.names;
  const produced = Object.keys(extract('x', 'x')).sort();
  assert.deepEqual([...names].sort(), produced);
});

test('years is the largest figure stated, capped, with the gap above six', () => {
  // Postings list a small number for a nice-to-have and a large one for the
  // core ask, so the binding requirement is the maximum.
  const f = extract('Engineer', '2+ years with React, 9 years of Python required');
  assert.equal(f.years_required, 9);
  assert.equal(f.years_over_6, 3);
  assert.equal(extract('x', '40 years of combined team experience').years_required, 20);
});

test("German required and German nice-to-have are not the same feature", () => {
  const req = extract('Engineer', 'Fluent German required for this role.');
  const nice = extract('Engineer', 'German is a plus.');
  assert.equal(req.german_required, 1);
  assert.equal(nice.german_required, 0);
  assert.equal(nice.german_nice, 1);
});

test('word boundaries follow Python, which treats accented letters as word characters', () => {
  // JavaScript's \b is ASCII-only, so /\bremote\b/ would match inside
  // "remoteüber" while Python's would not. features.ts uses explicit
  // \p{L}\p{N}_ lookarounds for exactly this.
  assert.equal(extract('x', 'remoteüber').remote, 0);
  assert.equal(extract('x', 'fully remote role').remote, 1);
  assert.equal(extract('x', 'we are in München').loc_germany, 1);
});
