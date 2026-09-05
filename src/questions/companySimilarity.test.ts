/**
 * The claim being tested is narrow: among a handful of companies, blurb
 * similarity puts the right neighbour first. That is all the retrieval needs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companySection, rankBySimilarity } from './companySimilarity.js';

const PROTON = 'Proton builds end-to-end encrypted email, VPN and cloud storage. We are open source, ' +
  'Swiss-based, funded by our users rather than advertisers, and we believe privacy is a fundamental right.';
const TUTANOTA = 'Tutanota is an open source, end-to-end encrypted email service. We are privacy-first, ' +
  'ad-free, funded by subscriptions, and we believe everyone deserves confidential communication.';
const LANGFUSE = 'Langfuse is open source LLM engineering. We build observability, evaluation and prompt ' +
  'management tooling for developers building with large language models. Small team, Berlin, YC-backed.';
const GOLDMAN = 'Goldman Sachs is a leading global investment bank providing services in investment banking, ' +
  'securities, asset management and wealth management to corporations, institutions and governments.';

test('the nearest company is the one with the same mission', () => {
  const ranked = rankBySimilarity(
    { id: 'proton', text: PROTON },
    [{ id: 'goldman', text: GOLDMAN }, { id: 'tutanota', text: TUTANOTA }, { id: 'langfuse', text: LANGFUSE }]
  );
  assert.equal(ranked[0].id, 'tutanota', `expected tutanota first, got ${ranked.map(r => r.id).join(' > ')}`);
  assert.equal(ranked[ranked.length - 1].id, 'goldman');
});

test('similarity is a number between 0 and 1', () => {
  const ranked = rankBySimilarity({ id: 'a', text: PROTON }, [{ id: 'b', text: TUTANOTA }]);
  assert.ok(ranked[0].score > 0 && ranked[0].score <= 1, `got ${ranked[0].score}`);
});

test('an empty corpus ranks nothing rather than throwing', () => {
  assert.deepEqual(rankBySimilarity({ id: 'a', text: PROTON }, []), []);
});

// companySection is the half roleSection() discards. For ranking a role the
// blurb is noise; for "why this company" it is the only part that matters.
test('the company blurb is taken from before the requirements', () => {
  const posting = `${PROTON}\n\nWhat you'll do:\n- Build React components\n- Write TypeScript`;
  const section = companySection(posting);
  assert.ok(section.includes('privacy is a fundamental right'));
  assert.ok(!section.includes('React components'), section);
});

test('a posting with no requirements marker still yields a blurb', () => {
  assert.ok(companySection(LANGFUSE).includes('Langfuse'));
});
