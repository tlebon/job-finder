/**
 * Regression tests for the job filter.
 *
 * Every case here is a bug that actually shipped and silently distorted results
 * for months. They share one shape: a regex matched text that says nothing
 * about the role - a substring of another word, or the company's boilerplate.
 * That class of bug is invisible in aggregate numbers, which is why it survived
 * so long, and it is exactly what a test catches cheaply.
 *
 * Run: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterJob } from './jobFilter.js';
import { matchedTechCategories, filterConfig } from '../config.js';
import type { RawJob } from '../types.js';

function job(overrides: Partial<RawJob> = {}): RawJob {
  return {
    title: 'Senior Frontend Engineer',
    company: 'Example GmbH',
    location: 'Berlin, Germany',
    url: 'https://example.com/job/1',
    description: 'We are looking for a React and TypeScript engineer.',
    source: 'other',
    ...overrides,
  } as RawJob;
}

// --- substring false positives -------------------------------------------
// /defi/i matched "define" in 45% of all job descriptions, inflating scores
// for the entire life of the project.

test('"define" and "redefine" do not register as web3', () => {
  const cats = matchedTechCategories('We define and redefine how business is conducted online.');
  assert.ok(!cats.includes('web3'), `expected no web3, got: ${cats.join(',')}`);
});

test('actual DeFi still registers as web3', () => {
  assert.ok(matchedTechCategories('Experience with DeFi protocols and liquidity pools').includes('web3'));
});

// "cryptographic" is not crypto-the-industry
test('"cryptographic" does not register as web3', () => {
  assert.ok(!matchedTechCategories('revamp our cryptographic model').includes('web3'));
});

// "end-to-end ownership" appeared in 29% of postings and was reading as privacy
test('"end-to-end ownership" does not register as privacy', () => {
  const cats = matchedTechCategories('You will have end-to-end ownership of features.');
  assert.ok(!cats.includes('privacy'), `expected no privacy, got: ${cats.join(',')}`);
});

test('actual end-to-end encryption still registers as privacy', () => {
  assert.ok(matchedTechCategories('an end-to-end encrypted messaging platform').includes('privacy'));
});

// --- title exclusions ------------------------------------------------------
// /\bstaff\b/ excluded "Member of Technical Staff", the standard IC title at
// Anthropic, OpenAI and Perplexity.

test('Member of Technical Staff is not excluded as too senior', () => {
  const r = filterJob(job({ title: 'Member of Technical Staff, Evaluations' }));
  assert.ok(
    !r.matchedCriteria.some(c => c.startsWith('EXCLUDED')),
    `should not be excluded: ${r.matchedCriteria.join(' | ')}`
  );
});

test('Staff Software Engineer is still excluded as too senior', () => {
  const r = filterJob(job({ title: 'Staff Software Engineer' }));
  assert.ok(r.matchedCriteria.some(c => c.includes('EXCLUDED')));
});

// --- company boilerplate must not pass a role ------------------------------
// Every posting at an AI company mentions Claude/LLM/ML in its blurb, so the
// lenient "2+ tech categories" rule passed Research Counsel and Cash Manager.

const AI_COMPANY_BOILERPLATE =
  'Anthropic is an AI safety company. We build Claude, a large language model. ' +
  'Our research spans machine learning, LLM alignment and interpretability. ' +
  'We use Python and distributed infrastructure at scale.';

test('non-engineering role at an AI company does not pass on boilerplate', () => {
  for (const title of [
    'Research Counsel',
    'Cash Manager, Treasury',
    'Director, Revenue Accounting',
    'AV Operations Specialist',
    'IT Support Engineer',
  ]) {
    const r = filterJob(job({ title, company: 'Anthropic', description: AI_COMPANY_BOILERPLATE, location: 'San Francisco, CA' }));
    assert.equal(r.passed, false, `"${title}" should not pass on company boilerplate`);
  }
});

test('genuine engineering role at the same company does pass', () => {
  const r = filterJob(job({
    title: 'Research Engineer, Machine Learning',
    company: 'Anthropic',
    description: AI_COMPANY_BOILERPLATE,
    location: 'San Francisco, CA',
  }));
  assert.equal(r.passed, true, `criteria: ${r.matchedCriteria.join(' | ')}`);
});

// --- location gate ---------------------------------------------------------
// The gate is meant to mean "Europe or the USA" but listed ~15 cities, so a
// posting reading only "San Francisco" matched nothing and was rejected.

test('bare US city names match the location gate', () => {
  for (const location of ['San Francisco', 'New York', 'Seattle', 'Boston', 'Berkeley']) {
    assert.ok(
      filterConfig.includeLocations.some(p => p.test(location)),
      `"${location}" should match a location pattern`
    );
  }
});

test('bare European city names match the location gate', () => {
  for (const location of ['Belgrade', 'Warsaw', 'Prague', 'Jena', 'Lisbon']) {
    assert.ok(
      filterConfig.includeLocations.some(p => p.test(location)),
      `"${location}" should match a location pattern`
    );
  }
});

test('locations outside Europe and the USA are still rejected', () => {
  for (const location of ['Beijing, China', 'Tel Aviv, Israel', 'Singapore']) {
    assert.ok(
      !filterConfig.includeLocations.some(p => p.test(location)),
      `"${location}" should not match`
    );
  }
});

// --- target roles ----------------------------------------------------------
// DS/AI titles were in excludeTitles, so these could never pass.

test('data science and AI titles pass', () => {
  for (const title of [
    'Data Scientist',
    'Machine Learning Engineer',
    'AI Engineer',
    'Research Engineer',
    'Cyber Evaluations Engineer',
  ]) {
    const r = filterJob(job({
      title,
      description: 'Python, PyTorch and LLM work. Remote friendly.',
      location: 'Berlin, Germany',
    }));
    assert.equal(r.passed, true, `"${title}" should pass: ${r.matchedCriteria.join(' | ')}`);
  }
});

// --- scoring shape ---------------------------------------------------------

test('every description-derived score term is bounded', () => {
  // The original bug was unbounded growth: each extra keyword paid again, so a
  // verbose posting beat a terse one for the same role. Some reward for genuine
  // breadth is fine; unbounded reward is not. Caps: tech 4x8, boost 5x3,
  // domain 2x8 = 68 from description text, plus title and location.
  const stuffed = 'React TypeScript Vue Svelte Next.js Redux Node NestJS Express FastAPI GraphQL ' +
    'Postgres Prisma Supabase Python PyTorch TensorFlow pandas NumPy SQL LLM RAG LangChain ' +
    'Docker Kubernetes AWS Terraform blockchain web3 Solidity encryption privacy e2e ' +
    'machine learning deep learning data science senior visa sponsorship relocation';

  const stuffedScore = filterJob(job({ description: stuffed })).score;

  // Same posting with the description repeated three times must not score more:
  // repetition is not extra evidence.
  const repeated = filterJob(job({ description: `${stuffed} ${stuffed} ${stuffed}` })).score;
  assert.equal(repeated, stuffedScore, 'repeating the description must not raise the score');

  // And the description alone cannot exceed the sum of its caps.
  const DESCRIPTION_MAX = 4 * 8 + 5 * 3 + 2 * 8; // tech + boost + domain
  const titleAndLocation = filterJob(job({ description: '' })).score;
  assert.ok(
    stuffedScore - titleAndLocation <= DESCRIPTION_MAX,
    `description contributed ${stuffedScore - titleAndLocation}, cap is ${DESCRIPTION_MAX}`
  );
});

test('categories are reported so the UI can filter on them', () => {
  const r = filterJob(job({ description: 'PyTorch, LLM evaluation, and React frontend work.' }));
  assert.ok(r.categories.includes('ml'));
  assert.ok(r.categories.includes('frontend'));
});

test('US on-site is flagged for relocation rather than excluded', () => {
  const r = filterJob(job({
    title: 'Machine Learning Engineer',
    location: 'San Francisco, CA',
    description: 'PyTorch and LLM work, on-site.',
  }));
  assert.equal(r.passed, true, 'US roles should pass');
  assert.equal(r.requiresRelocation, true, 'and be flagged as needing a move');
});

// --- the whitelist must not become a wall -----------------------------------
// Requiring an exact includeTitles match rejected 58% of all jobs on "no title
// match", including the Anthropic Fellows Program Tim is applying to.

test('engineering-shaped titles pass without being enumerated', () => {
  for (const title of [
    'Anthropic Fellows Program, AI Safety & Security',
    'Forward Deployed Engineer',
    'Applied AI Architect',
    'Member of the Technical Staff',
    'Product Engineer',
    'Bioinformatics Engineer',
  ]) {
    const r = filterJob(job({
      title,
      description: 'Python, PyTorch, LLM and distributed systems work.',
      location: 'Berlin, Germany',
    }));
    assert.equal(r.passed, true, `"${title}" should pass: ${r.matchedCriteria.join(' | ')}`);
  }
});

test('shape does not readmit the non-engineering roles', () => {
  for (const title of ['AV Engineer', 'Data Center Electrical Engineer', 'Research Counsel']) {
    const r = filterJob(job({
      title,
      company: 'Anthropic',
      description: AI_COMPANY_BOILERPLATE,
      location: 'San Francisco, CA',
    }));
    assert.equal(r.passed, false, `"${title}" should still be excluded`);
  }
});

// --- the scorer should prefer the pivot -------------------------------------

test('ml and llm roles outrank a generic web stack', () => {
  const ml = filterJob(job({
    title: 'Machine Learning Engineer',
    description: 'PyTorch, LLM fine-tuning, RAG, embeddings, Python',
  })).score;
  const web = filterJob(job({
    title: 'Senior Frontend Engineer',
    description: 'React TypeScript Node AWS Docker Postgres GraphQL',
  })).score;
  assert.ok(ml > web, `ml (${ml}) should outrank generic web (${web})`);
});

// Company identity read out of a posting was worth +16, more than the Berlin
// bonus. /privacy/ mostly matched GDPR footers; /e2e/ matched end-to-end tests.
test('a GDPR footer and e2e testing earn no domain bonus', () => {
  const r = filterJob(job({
    description: 'React and TypeScript. See our Candidate Privacy Notice. ' +
      'We run unit, integration and e2e tests. Approval matrix applies.',
  }));
  assert.ok(
    !r.matchedCriteria.some(c => c.startsWith('Domain:')),
    `should earn no domain bonus: ${r.matchedCriteria.join(' | ')}`
  );
});

test('a genuine privacy company still earns the domain bonus', () => {
  const r = filterJob(job({ company: 'Proton AG', description: 'React and TypeScript.' }));
  assert.ok(r.matchedCriteria.some(c => c.startsWith('Domain:')), 'Proton should match on company');
});
