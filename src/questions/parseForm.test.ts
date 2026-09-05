/**
 * Every case here comes from a form Tim actually pasted - Greenhouse, Lever and
 * four Ashby forms. The parser was written against them and each fix below is a
 * mistake it made on real input rather than an invented edge case.
 *
 * Run: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseForm, detectAts } from './parseForm.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, '__fixtures__', `${name}.txt`), 'utf8');

const granola = fixture('granola-ashby');
const metr = fixture('metr-lever');

const questions = (text: string) => parseForm(text).map(f => f.question);

test('the platform is detected from what the clipboard leaves behind', () => {
  assert.equal(detectAts(granola), 'ashby');
  assert.equal(detectAts(metr), 'lever');
});

// Helper text sits under the question and explains it. An early version turned
// every line of it into a question of its own, so "Think of this as your
// super-condensed cover letter" became something to answer.
test('helper text is absorbed, not treated as a question', () => {
  const qs = questions(granola);
  assert.ok(!qs.some(q => q.startsWith('Think of this as')), qs.join(' | '));
  assert.ok(!qs.some(q => q.startsWith("While there's plenty of flexibility")), qs.join(' | '));
});

// A real question can trail off into examples and end in a full stop:
// "...E.g. other jobs, coursework, exams, etc." Requiring a trailing question
// mark silently dropped four of METR's fields.
test('questions that end in an example are still questions', () => {
  const qs = questions(metr);
  for (const fragment of [
    'Up to how many hours per week',
    'Will you have other time commitments',
    'How much experience, if any, do you have with the Inspect',
    "What's the best evidence",
  ]) {
    assert.ok(qs.some(q => q.includes(fragment)), `lost: ${fragment}`);
  }
});

// The option scan used to run past its own field and collect the Yes/No
// belonging to the next one, so salary expectations came back with options.
test('options attach to the question above them and stop at the next one', () => {
  const fields = parseForm(granola);
  const salary = fields.find(f => f.question.includes('salary expectations'));
  const office = fields.find(f => f.question.includes('Old Street'));
  assert.equal(salary?.options, undefined, 'a free-text field should carry no options');
  assert.deepEqual(office?.options, ['Yes', 'No']);
});

test('option values do not become questions of their own', () => {
  const qs = questions(metr);
  assert.ok(!qs.includes('Nothing about your application'), qs.join(' | '));
  assert.ok(!qs.includes('Your name, email, and resume'));
});

test('stated length limits are captured', () => {
  const fields = parseForm(granola);
  assert.match(fields.find(f => f.question === 'Why Granola?')?.lengthLimit ?? '', /5 sentences or less/i);
  assert.match(
    fields.find(f => f.question.includes('absolutely know about you'))?.lengthLimit ?? '',
    /one line/i
  );
});

// Fields Tim answers from memory in seconds should never sit beside ones that
// cost him twenty minutes.
test('mechanical fields are separated from prose', () => {
  const fields = parseForm(metr);
  const kind = (needle: string) => fields.find(f => f.question.includes(needle))?.kind;
  assert.equal(kind('Full name'), 'mechanical');
  assert.equal(kind('Linkedin URL'), 'mechanical');
  assert.equal(kind('Why METR?'), 'prose');
  assert.equal(kind('How soon could you start'), 'decision');
});

test('required markers survive both platforms', () => {
  assert.equal(parseForm(metr).find(f => f.question === 'Why METR?')?.required, true);
  assert.equal(parseForm(metr).find(f => f.question.includes('Anything else'))?.required, false);
});
