/**
 * The batch review parses JSON the model wrote. When that parse throws, every
 * job in the batch is written as MAYBE *and marked reviewed*, so it never comes
 * back for another look - a silent, permanent downgrade.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Mirrors the normalisation applied in reviewBatch before JSON.parse. */
function normalize(jsonText: string): string {
  return jsonText.replace(/:\s*\+(\d)/g, ': $1');
}

test('a signed positive adjustment parses', () => {
  // Seen in production: the model writes "+20" the way a person would.
  const raw = '[{"jobId":"a","suggestion":"GOOD_FIT","reasoning":"x","scoreAdjustment": +20}]';
  assert.throws(() => JSON.parse(raw), 'precondition: raw JSON is invalid');
  const parsed = JSON.parse(normalize(raw));
  assert.equal(parsed[0].scoreAdjustment, 20);
});

test('negative and unsigned adjustments are untouched', () => {
  for (const [raw, expected] of [['-30', -30], ['0', 0], ['15', 15]] as const) {
    const parsed = JSON.parse(normalize(`[{"scoreAdjustment": ${raw}}]`));
    assert.equal(parsed[0].scoreAdjustment, expected);
  }
});

test('a plus inside reasoning text is not mangled', () => {
  const raw = '[{"reasoning":"React + TypeScript, 5+ years","scoreAdjustment": +10}]';
  const parsed = JSON.parse(normalize(raw));
  assert.equal(parsed[0].reasoning, 'React + TypeScript, 5+ years');
  assert.equal(parsed[0].scoreAdjustment, 10);
});

// --- desire and reach are separate answers ----------------------------------
// Collapsing them made a verdict uninformative: a moonshot and a poor match both
// came out MAYBE and nothing downstream could tell them apart.

test('a reach value is kept only when it is one of the three levels', () => {
  const valid = ['realistic', 'stretch', 'moonshot'];
  const keep = (r: unknown) => (valid.includes(r as string) ? r : undefined);

  assert.equal(keep('moonshot'), 'moonshot');
  assert.equal(keep('realistic'), 'realistic');
  // A model that invents a level must not have it written to the database,
  // where it would quietly break any filter reading the column.
  assert.equal(keep('very hard'), undefined);
  assert.equal(keep(undefined), undefined);
  assert.equal(keep(''), undefined);
});

test('reach parses alongside a signed adjustment', () => {
  const raw = '[{"jobId":"a","suggestion":"STRONG_FIT","reach":"moonshot","reasoning":"x","scoreAdjustment": +40}]';
  const parsed = JSON.parse(normalize(raw));
  assert.equal(parsed[0].reach, 'moonshot');
  assert.equal(parsed[0].scoreAdjustment, 40);
});

// --- an outage is not a verdict ---------------------------------------------
// reviewBatch falls back to MAYBE on error AND the job is marked reviewed, so it
// never comes back. When the Anthropic credit balance ran out mid-run, 603
// batches failed that way and 892 real verdicts were overwritten with a
// fabricated MAYBE before anything noticed.

/** Mirrors the check in reviewBatch. */
function isSystemic(message: string): boolean {
  return /credit balance|authentication|invalid x-api-key|permission|not_found_error/i.test(message);
}

test('failures that will not fix themselves are recognised', () => {
  for (const message of [
    'BadRequestError: 400 {"type":"error","error":{"message":"Your credit balance is too low"}}',
    'AuthenticationError: invalid x-api-key',
    'PermissionError: permission denied for this model',
  ]) {
    assert.ok(isSystemic(message), `should abort the run: ${message.slice(0, 50)}`);
  }
});

test('transient failures still fall back rather than aborting', () => {
  for (const message of [
    'SyntaxError: Unexpected token in JSON at position 12',
    'APIConnectionError: socket hang up',
    'RateLimitError: 429 too many requests',
  ]) {
    assert.ok(!isSystemic(message), `should retry later, not abort: ${message.slice(0, 50)}`);
  }
});
