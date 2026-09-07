import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salaryReference, toEur, type PostingLike } from './postingAnalysis.js';

const p = (id: string, title: string, location: string, description: string): PostingLike =>
  ({ id, title, company: id, location, description });

test('currencies are normalised to annual EUR', () => {
  assert.deepEqual(toEur('€90K – €160K'), [90000, 160000]);
  assert.deepEqual(toEur('$200K – $350K'), [184000, 322000]);
  assert.deepEqual(toEur('90.000 - 160.000 EUR'), [90000, 160000]);
});

test('a headcount or a year is not read as a salary', () => {
  assert.equal(toEur('500+ team members across 50+ countries'), null);
  assert.equal(toEur('founded in 2014'), null);
});

// The point of the whole module: a location bucket puts a senior ML role and a
// junior frontend role in the same pool, and the median answers neither.
test('comparators resemble the role, not merely the country', () => {
  const corpus = [
    p('ml-berlin', 'Senior Machine Learning Engineer', 'Berlin, Germany', 'Senior. 5+ years. Salary €120K - €160K'),
    p('ml-munich', 'Machine Learning Engineer', 'Munich, Germany', 'Senior. Salary €110K - €150K'),
    p('ml-hamburg', 'Senior Machine Learning Engineer', 'Hamburg, Germany', 'Senior. Salary €115K - €155K'),
    p('junior-fe', 'Junior Frontend Developer', 'Berlin, Germany', 'Junior, entry-level. Salary €45K - €60K'),
    p('grad-fe', 'Graduate Frontend Developer', 'Berlin, Germany', 'Graduate. Salary €40K - €55K'),
  ];
  const ref = salaryReference(
    p('target', 'Senior Machine Learning Engineer', 'Berlin, Germany', 'Senior, 5+ years'),
    corpus
  );
  assert.ok(ref.comparators.length >= 3);
  assert.match(ref.comparators[0].title, /Machine Learning/, ref.comparators.map(c => c.title).join(' | '));
  // The junior and graduate roles are in the same country and must not be here.
  assert.ok(
    !ref.comparators.some(c => /Junior|Graduate/.test(c.title)),
    ref.comparators.map(c => c.title).join(' | ')
  );
  assert.ok((ref.median ?? 0) > 90000, `median ${ref.median} should reflect the ML roles, not the graduate ones`);
});

test('a corpus with no stated salaries reports nothing rather than guessing', () => {
  const ref = salaryReference(
    p('t', 'Engineer', 'Berlin', 'no numbers here'),
    [p('a', 'Engineer', 'Berlin', 'also no numbers')]
  );
  assert.equal(ref.n, 0);
  assert.equal(ref.median, undefined);
});

test('too few comparators reports the count without quartiles', () => {
  const ref = salaryReference(
    p('t', 'Senior Machine Learning Engineer', 'Berlin', 'Senior'),
    [p('a', 'Senior Machine Learning Engineer', 'Berlin', 'Senior. Salary €120K - €160K')]
  );
  assert.ok(ref.n <= 2);
  assert.equal(ref.median, undefined, 'quartiles over one or two points would be false precision');
});
