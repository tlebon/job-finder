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
import { filterJob, filterJobs } from './jobFilter.js';
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

// Sampling what this rule rejected found 33% good, including three Anthropic
// Staff Software Engineer roles. Tim was an EM at Wire with 6+ years, and
// Anthropic is a company he wants surfaced whether or not a role is a stretch.
test('Staff and Principal titles are not excluded as too senior', () => {
  for (const title of ['Staff Software Engineer, Claude Code', 'Principal Research Engineer, AI Safety']) {
    const r = filterJob(job({ title, description: 'Python, PyTorch and LLM work.' }));
    assert.ok(
      !r.matchedCriteria.some(c => c.startsWith('EXCLUDED')),
      `"${title}" should not be excluded: ${r.matchedCriteria.join(' | ')}`
    );
  }
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

test('locations outside Europe and the USA earn no proximity bonus', () => {
  for (const location of ['Beijing, China', 'Tel Aviv, Israel', 'Singapore']) {
    assert.ok(
      !filterConfig.includeLocations.some(p => p.test(location)),
      `"${location}" should not match includeLocations`
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

// --- geography ---------------------------------------------------------------
// The remote terms are permissive on purpose - "Remote" alone should pass - but
// a match anywhere in the string also passed roles in Tokyo, Bengaluru and Dubai
// that happened to say "remote".

// Was an exclusion, and it cost a STRONG_FIT at a Korean AI-safety lab. Tim
// will move anywhere for the right role with relocation support, so distance is
// a flag he can toggle in the UI, not a rejection made on his behalf.
test('roles outside Europe and the USA pass, flagged for relocation', () => {
  for (const location of ['Remote - Tokyo, Japan', 'Bengaluru, India (Remote)', 'Seoul, South Korea', 'Toronto, Canada']) {
    const r = filterJob(job({ title: 'Machine Learning Engineer', location, description: 'PyTorch and LLM work.' }));
    assert.equal(r.passed, true, `"${location}" should pass: ${r.matchedCriteria.join(' | ')}`);
    assert.equal(r.requiresRelocation, true, `"${location}" should be flagged for relocation`);
  }
});

test('a Berlin role is not flagged for relocation', () => {
  const r = filterJob(job({ title: 'Machine Learning Engineer', location: 'Berlin, Germany', description: 'PyTorch work.' }));
  assert.notEqual(r.requiresRelocation, true);
});

test('genuinely remote roles in range still pass', () => {
  for (const location of ['Remote', 'Remote - Europe', 'Remote (US)', 'Remote - Berlin']) {
    const r = filterJob(job({ title: 'Machine Learning Engineer', location, description: 'PyTorch and LLM work.' }));
    assert.equal(r.passed, true, `"${location}" should pass: ${r.matchedCriteria.join(' | ')}`);
  }
});

// --- backend is not disqualifying for ML work --------------------------------
// The rule was written when the target was frontend-only. ML engineering is
// backend work, and this rejected Perplexity's MTS Backend Platform outright.

test('backend roles with ML signal are not excluded', () => {
  for (const title of ['Member of Technical Staff, Backend Platform', 'Backend Engineer, Inference', 'Python Developer, ML Platform']) {
    const r = filterJob(job({ title, description: 'PyTorch, LLM inference, model serving at scale.', location: 'Berlin, Germany' }));
    assert.ok(
      !r.matchedCriteria.some(c => c.includes('Backend-only')),
      `"${title}" should not be excluded as backend-only`
    );
  }
});

test('plain backend CRUD is still excluded', () => {
  const r = filterJob(job({ title: 'Senior Java Developer', description: 'Spring Boot, Hibernate, Oracle, REST APIs.' }));
  assert.ok(r.matchedCriteria.some(c => c.includes('Backend-only')), `criteria: ${r.matchedCriteria.join(' | ')}`);
});

// --- a category must describe the role, not the company ----------------------
// The ml/llm tags do match company blurb - every posting at an AI company names
// Claude and machine learning. Discounting evidence found outside the title and
// requirements was tried and measured worse in every configuration, so the
// broad match stands and the knob is off. What must still hold is that the
// categories reported to the UI come from the whole posting.

const AI_BLURB =
  'Anthropic is an AI safety company. We build Claude, a large language model. ' +
  'Our research spans machine learning, LLM alignment and interpretability. ';

test('categories are reported from the whole posting', () => {
  const r = filterJob(job({ title: 'Software Engineer', description: AI_BLURB + 'React work.' }));
  assert.ok(r.categories.includes('ml'), `categories: ${r.categories.join(',')}`);
  assert.ok(r.categories.includes('llm'));
  assert.ok(r.categories.includes('frontend'));
});

// A US on-site role was cleared of needing relocation because its description
// mentioned "distributed systems" - the whole description was searched for
// /\bdistributed\b/. "global customers" did the same via /\bglobal\b/.
test('technical vocabulary does not clear a US role of relocation', () => {
  for (const description of [
    'You will build distributed systems at scale in Python.',
    'We serve global customers across many markets.',
    'Own services end to end for a worldwide user base.',
  ]) {
    const r = filterJob(job({ title: 'Machine Learning Engineer', location: 'San Francisco, CA', description }));
    assert.equal(r.requiresRelocation, true, `should still need relocation: "${description}"`);
  }
});

test('a genuinely remote US role is not flagged for relocation', () => {
  for (const [location, description] of [
    ['Remote (US)', 'Build systems in Python.'],
    ['San Francisco, CA', 'This is a fully remote position.'],
    ['New York, NY', 'We are remote-first.'],
  ] as const) {
    const r = filterJob(job({ title: 'Machine Learning Engineer', location, description }));
    assert.notEqual(r.requiresRelocation, true, `should not need relocation: "${location}" / "${description}"`);
  }
});

// --- the gate must not destroy the evidence ---------------------------------
// filterJobs used to count rejects and drop them, so the gate's own recall was
// unmeasurable and any model trained on the stored corpus learned from
// survivors while being asked to rank the whole stream.

test('filterJobs returns the rejects, with the rule that rejected them', () => {
  const jobs = [
    job({ title: 'Machine Learning Engineer', description: 'PyTorch and LLM work.' }),
    job({ title: 'Enterprise Account Executive', description: 'Close deals across DACH.' }),
    job({ title: 'Senior Java Developer', description: 'Spring Boot, Hibernate, Oracle.' }),
  ];
  const { passed, filtered, rejected } = filterJobs(jobs);

  assert.equal(passed.length + rejected.length, jobs.length, 'every job is accounted for');
  assert.equal(rejected.length, filtered, 'the count and the list agree');
  assert.ok(rejected.every(r => r.reason.length > 0), 'each reject carries a reason');
  assert.ok(
    rejected.some(r => r.reason.includes('account executive')),
    `expected an account-executive rejection: ${rejected.map(r => r.reason).join(' | ')}`
  );
});

// --- the model rescues what the rules miss ----------------------------------
// The regex gate keeps 37.2% of the stream at 60.3% recall against Tim's own
// labels; the model keeps 35.2% at 73.9%. It runs as a rescue rather than a
// replacement, so it can only add candidates.

test('the model score is reported for every job that clears the exclusions', () => {
  const r = filterJob(job({ title: 'Machine Learning Engineer', description: 'PyTorch and LLM work.' }));
  assert.ok(typeof r.modelScore === 'number', 'modelScore should be present');
  assert.ok(r.modelScore! >= 0 && r.modelScore! <= 1, `expected a probability, got ${r.modelScore}`);
});

test('a rescue cannot resurrect an excluded role', () => {
  // Exclusions run before the model, and the function rules were measured at
  // zero false negatives over 43 of Tim's labels.
  for (const title of ['Enterprise Account Executive, Automotive', 'Technical Recruiter, AI']) {
    const r = filterJob(job({ title, company: 'Anthropic', description: AI_BLURB, location: 'San Francisco, CA' }));
    assert.equal(r.passed, false, `"${title}" must stay excluded regardless of model score`);
  }
});

test('the rescue is additive - anything the rules kept is still kept', () => {
  const jobs = [
    job({ title: 'Machine Learning Engineer', description: 'PyTorch, LLM, Python.' }),
    job({ title: 'Senior Frontend Engineer', description: 'React and TypeScript.' }),
    job({ title: 'Research Engineer', description: 'Deep learning and evals.' }),
  ];
  for (const j of jobs) {
    assert.equal(filterJob(j).passed, true, `"${j.title}" should still pass`);
  }
});

// Product management sat in includeTitles as an explicit request, scoring +10
// and passing the gate on the title alone - which is how two Anthropic PM roles
// reached the reviewer and came back STRONG_FIT. Withdrawn 2026-09-05.
test('product management titles are excluded', () => {
  for (const title of ['Product Manager, Safeguards', 'Technical Product Manager', 'Product Owner', 'Programme Manager']) {
    const r = filterJob(job({ title, company: 'Anthropic', description: AI_BLURB, location: 'San Francisco, CA' }));
    assert.equal(r.passed, false, `"${title}" should be excluded: ${r.matchedCriteria.join(' | ')}`);
  }
});

test('engineering management is still allowed', () => {
  // He was an EM at Wire and is open to it at the right company.
  const r = filterJob(job({ title: 'Engineering Manager', description: 'Hands-on with Python and PyTorch.' }));
  assert.equal(r.passed, true, `criteria: ${r.matchedCriteria.join(' | ')}`);
});
