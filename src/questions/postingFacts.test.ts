import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postingFacts } from './postingFacts.js';

// Both from real postings Tim pasted.
test('a stated salary range is pulled out', () => {
  assert.match(postingFacts('Compensation\n$200K – $350K\nU.S. Benefits').salary ?? '', /200K.*350K/);
  assert.match(postingFacts('Compensation\nSalary €90K – €160K • Offers Equity').salary ?? '', /90K.*160K/);
});

test('European formatting is handled', () => {
  assert.match(postingFacts('Gehalt: 90.000 - 160.000 EUR pro Jahr').salary ?? '', /90\.000/);
});

test('nothing is invented when no salary is stated', () => {
  assert.equal(postingFacts('We are hiring a frontend engineer in Berlin.').salary, undefined);
});

test('office days and remote posture are picked up', () => {
  assert.match(postingFacts('willing to work from our office in San Francisco 3+ days a week').onsiteDays ?? '', /3/);
  assert.equal(postingFacts('This is a fully remote position.').remote, 'fully remote');
  assert.equal(postingFacts('We work hybrid, two days together.').remote, 'hybrid');
});

// "5+ years" must not read as five days a week in an office.
test('an experience requirement is not mistaken for office days', () => {
  assert.equal(postingFacts('We want 5+ years of experience building web apps.').onsiteDays, undefined);
});
