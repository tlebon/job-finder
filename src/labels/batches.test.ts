import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BATCHES, batchOf, evalEligible } from './batches.js';

test('every stratum in the database resolves to a batch', () => {
  // The full set as of 2026-09-08; the default entry has to catch new sources.
  const strata = [
    'triage', 'reject|uncertain', 'reject|low', 'reject|high', 'reject|confident-no',
    'adzuna|pass', 'adzuna|reject', 'ats|pass', 'ats|reject',
    'arbeitnow|pass', 'arbeitnow|reject', '80000hours|pass', '80000hours|reject',
    'hn-whoishiring|pass', 'hn-whoishiring|reject', 'remoteok|pass', 'remoteok|reject',
    'jsearch|pass', 'somenewsource|pass',
  ];
  for (const s of strata) assert.ok(batchOf(s).id, `no batch for ${s}`);
});

test('triage never counts as evaluation data', () => {
  // The whole point of the registry. Triage is the top of the model's own
  // ranking - observed base rate 0.778 against 0.221 and 0.140 for the other
  // two epochs - so scoring on it measures agreement with the ranking that
  // chose it.
  assert.equal(evalEligible('triage'), false);
  assert.equal(batchOf('triage').selection, 'ranked');
  assert.equal(batchOf('triage').blind, 'partial');
});

test('the two probability samples are scoreable', () => {
  assert.equal(evalEligible('reject|uncertain'), true);
  assert.equal(evalEligible('adzuna|pass'), true);
  assert.equal(batchOf('reject|low').id, 'rejects-holdout');
  assert.equal(batchOf('ats|reject').id, 'source-stratified');
});

test('exactly one default entry, and it is last', () => {
  const defaults = BATCHES.filter(b => b.match.default);
  assert.equal(defaults.length, 1);
  assert.equal(BATCHES[BATCHES.length - 1].match.default, true);
});
