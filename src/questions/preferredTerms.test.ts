import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learnPreferences, highlight } from './preferredTerms.js';

const LABELLED = [
  { text: 'open source privacy encryption end-to-end team engineer', liked: true },
  { text: 'open source encryption privacy engineer remote', liked: true },
  { text: 'privacy open source encryption machine learning engineer', liked: true },
  { text: 'open source privacy encryption pytorch engineer', liked: true },
  { text: 'enterprise sales quota pipeline engineer', liked: false },
  { text: 'sales enterprise quota revenue engineer', liked: false },
  { text: 'enterprise quota pipeline sales engineer', liked: false },
  { text: 'quota sales revenue enterprise engineer', liked: false },
];

test('terms that separate liked from unliked get positive weight', () => {
  const w = learnPreferences(LABELLED, 2, 0);
  assert.ok((w.get('privacy') ?? 0) > 0, 'privacy should be positive');
  assert.ok((w.get('quota') ?? 0) < 0, 'quota should be negative');
});

// "engineer" is in every posting on both sides. Common is not the same as
// preferred, and an earlier framing would have ranked it top.
test('a term common to both sides carries no weight', () => {
  const w = learnPreferences(LABELLED, 2, 0);
  assert.ok(Math.abs(w.get('engineer') ?? 0) < 0.2, `engineer weighted ${w.get('engineer')}`);
});

test('terms too rare to estimate are dropped', () => {
  const w = learnPreferences([...LABELLED, { text: 'quantum blockchain metaverse', liked: true }], 4, 0);
  assert.equal(w.get('metaverse'), undefined);
});

test('highlighting picks the sentence carrying the liked terms', () => {
  const w = learnPreferences(LABELLED, 2, 0);
  const posting =
    'We are hiring an engineer to join the team in a fast paced environment. ' +
    'Our product is open source and built around privacy and end-to-end encryption for everyone. ' +
    'You will manage a sales quota across enterprise accounts and revenue pipeline.';
  const top = highlight(posting, w, 1);
  assert.equal(top.length, 1);
  assert.ok(top[0].sentence.includes('privacy'), top[0].sentence);
});

test('nothing is highlighted when there are no labels to learn from', () => {
  assert.deepEqual(highlight('Some posting text that is long enough to be a sentence here.', new Map()), []);
});

// "because", "ran" and "staying" were being reported as things Tim responds to.
// They appeared in a handful of liked postings and none of the disliked ones,
// which gives a high log-odds while saying nothing - distinctive is not the
// same as characteristic.
test('a term too rare among liked postings is dropped', () => {
  const many = [
    ...Array.from({ length: 40 }, () => ({ text: 'privacy encryption open source engineer', liked: true })),
    { text: 'privacy encryption open source engineer serendipitously', liked: true },
    ...Array.from({ length: 40 }, () => ({ text: 'sales quota enterprise revenue engineer', liked: false })),
  ];
  const w = learnPreferences(many, 1, 0.08);
  assert.ok((w.get('privacy') ?? 0) > 0, 'privacy is characteristic');
  assert.equal(w.get('serendipitously'), undefined, 'one appearance in 41 is not characteristic');
});
