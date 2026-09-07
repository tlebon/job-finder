/**
 * Reading a job posting: what the company says, what it pays, what it states.
 *
 * One file because it is imported by the web app through the @shared alias, and
 * that surface has to be self-contained. Turbopack will not rewrite a .js
 * specifier to the .ts file beside it, and the project's nodenext resolution
 * will not let the extension be dropped - so a shared module importing a
 * sibling cannot be built at all. Three small modules that only ever called
 * each other are one module instead.
 */

/**
 * The part of a posting that describes the company rather than the job.
 *
 * The exact half roleSection() throws away. For ranking, the "About us" blurb
 * is noise that says nothing about the role; for "why this company" it is the
 * only part that matters. Same text, opposite uses.
 */
export function companySection(description: string, limit = 2500): string {
  const text = (description ?? '').trim();
  if (!text) return '';

  // Everything before the requirements start. Failing that, the opening, which
  // is where companies introduce themselves.
  const marker = text.search(
    /(what you'?ll do|responsibilities|your role|the role|what we'?re looking for|requirements|qualifications|your profile|about the (job|role|position)|tech stack|you will)/i
  );
  // 80 characters, not 200: a blurb can be a single sentence, and requiring
  // more meant a short "About us" was discarded and the requirements returned
  // instead - the exact opposite of the intent.
  return (marker > 80 ? text.slice(0, marker) : text.slice(0, limit)).trim();
}

const STOP = new Set(
  ('a an the and or but if then than that this these those we our us you your they their it its is are was were be been being to of in on for with at by from as have has had do does did will would can could should our ' +
   'company team work working role position job opportunity candidate join looking hiring apply application new great strong excellent passionate ' +
   'employees people world global leading innovative mission driven fast paced growing').split(' ')
);

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]{1,}/gu) ?? [])
    .filter(t => t.length > 2 && !STOP.has(t));
}

export interface Doc { id: string; text: string }

/**
 * Cosine similarity of every document to one target, highest first.
 *
 * IDF is computed over the documents given, which is the right corpus here:
 * "encryption" is distinctive among a handful of companies Tim has written for,
 * even though it is common across job postings generally.
 */
export function rankBySimilarity(target: Doc, others: Doc[]): { id: string; score: number }[] {
  if (!others.length) return [];

  const all = [target, ...others];
  const docs = all.map(d => tokens(d.text));

  const df = new Map<string, number>();
  for (const d of docs) {
    for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const vectors = docs.map(d => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);

    const v = new Map<string, number>();
    let norm = 0;
    for (const [t, n] of tf) {
      // Smoothed IDF, and it matters more here than anywhere else in the
      // project. Plain log(N/df) with a handful of documents drives shared
      // terms to exactly zero - with two documents, any word appearing in both
      // scores log(1) = 0, so the terms that prove two companies are alike are
      // the ones thrown away and every similarity comes out as 0. Smoothing
      // keeps them positive at any corpus size.
      //
      // Sublinear tf as elsewhere: repetition is not extra evidence.
      const w = (1 + Math.log(n)) * (Math.log((1 + all.length) / (1 + (df.get(t) ?? 0))) + 1);
      if (w <= 0) continue;
      v.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of v) v.set(t, w / norm);
    return v;
  });

  const [a, ...rest] = vectors;
  return rest
    .map((b, i) => {
      let dot = 0;
      // Iterate the smaller side.
      const [small, large] = a.size < b.size ? [a, b] : [b, a];
      for (const [t, w] of small) dot += w * (large.get(t) ?? 0);
      return { id: others[i].id, score: dot };
    })
    .sort((x, y) => y.score - x.score);
}


export interface PostingFacts {
  salary?: string;
  remote?: string;
  onsiteDays?: string;
}

const SALARY = [
  // $200K – $350K   |   €90K - €160K
  /([€$£]\s?\d{2,3}[.,]?\d{0,3}\s*[kK]?)\s*[-–—]\s*([€$£]?\s?\d{2,3}[.,]?\d{0,3}\s*[kK]?)/,
  // 90.000 - 160.000 EUR
  /(\d{2,3}[.,]\d{3})\s*[-–—]\s*(\d{2,3}[.,]\d{3})\s*(EUR|USD|GBP|€|\$|£)/i,
  // Salary range: 90000 to 160000
  /salary[^.\n]{0,30}?(\d{2,3}[.,]?\d{3})\s*(?:to|[-–—])\s*(\d{2,3}[.,]?\d{3})/i,
];

/**
 * "N days a week" with office nearby on EITHER side. The first version required
 * office to follow, and the real posting reads "willing to work from our office
 * in San Francisco 3+ days a week" - office first, so it matched nothing.
 */
const ONSITE_DAYS = /(\d)\s*\+?\s*days?\s+(?:a|per)\s+week/i;
const ONSITE_NEARBY = /(office|on-?site|in person|in the office)/i;
const REMOTE = /\b(fully remote|remote-first|100% remote|hybrid|on-?site only)\b/i;

export function postingFacts(description: string): PostingFacts {
  const text = description ?? '';
  const facts: PostingFacts = {};

  for (const pattern of SALARY) {
    const m = text.match(pattern);
    if (m) {
      facts.salary = m[0].replace(/\s+/g, ' ').trim();
      break;
    }
  }

  const days = text.match(ONSITE_DAYS);
  if (days && days.index !== undefined) {
    const around = text.slice(Math.max(0, days.index - 60), days.index + days[0].length + 40);
    // Without the proximity check, "5+ years of experience" in a posting that
    // mentions an office anywhere would read as five days on site.
    if (ONSITE_NEARBY.test(around)) {
      facts.onsiteDays = days[0].replace(/\s+/g, ' ').trim();
    }
  }

  const remote = text.match(REMOTE);
  if (remote) facts.remote = remote[1].toLowerCase();

  return facts;
}


export interface SalaryComparator {
  title: string;
  company: string;
  location: string;
  salary: string;
  low: number;
  high: number;
  similarity: number;
}

export interface SalaryReference {
  n: number;
  p25?: number;
  median?: number;
  p75?: number;
  currency: 'EUR';
  comparators: SalaryComparator[];
}

/** Roughly, to annual EUR. Rates are indicative and only need to be close. */
const RATE: Record<string, number> = { $: 0.92, '£': 1.17, '€': 1 };

export function toEur(raw: string): [number, number] | null {
  const symbol = (raw.match(/[$£€]/) ?? ['€'])[0];
  const rate = RATE[symbol] ?? 1;
  const parsed = (raw.match(/\d{1,3}(?:[.,]\d{3})?(?:\s*[kK])?/g) ?? [])
    .map(n => {
      const thousands = /[kK]/.test(n);
      const value = Number(n.replace(/[.,\s kK]/g, ''));
      return thousands ? value * 1000 : value;
    })
    // A range, not a headcount or a year: below 20k is not an annual salary and
    // above 600k is not a role Tim is applying to.
    .filter(v => v > 20000 && v < 600000);

  if (parsed.length < 2) return null;
  return [Math.round(parsed[0] * rate), Math.round(parsed[1] * rate)];
}

export interface PostingLike {
  id: string; title: string; company: string; location: string; description: string;
}

/**
 * The text similarity is computed over: title, location, and the seniority
 * words, rather than the whole posting.
 *
 * A full description is mostly benefits and boilerplate shared by every posting,
 * which drowns the few words that decide what a role pays.
 */
function comparisonText(p: PostingLike): string {
  const seniority = (p.description.match(
    /\b(junior|mid[- ]level|senior|staff|principal|lead|head of|director|entry[- ]level|graduate|\d{1,2}\+?\s*years?)\b/gi
  ) ?? []).slice(0, 6).join(' ');
  return `${p.title} ${p.title} ${p.location} ${seniority}`;
}

export function salaryReference(
  target: PostingLike,
  corpus: PostingLike[],
  topN = 15
): SalaryReference {
  const priced = corpus
    .filter(p => p.id !== target.id)
    .map(p => {
      const stated = postingFacts(p.description).salary;
      const eur = stated ? toEur(stated) : null;
      return eur ? { p, stated: stated!, eur } : null;
    })
    .filter(Boolean) as { p: PostingLike; stated: string; eur: [number, number] }[];

  if (!priced.length) return { n: 0, currency: 'EUR', comparators: [] };

  const ranked = rankBySimilarity(
    { id: target.id, text: comparisonText(target) },
    priced.map(x => ({ id: x.p.id, text: comparisonText(x.p) }))
  );

  const byId = new Map(priced.map(x => [x.p.id, x]));
  const comparators = ranked
    .slice(0, topN)
    // Below this the "comparable" role has nothing in common, and including it
    // is worse than reporting a smaller sample.
    .filter(r => r.score > 0.12)
    .map(r => {
      const x = byId.get(r.id)!;
      return {
        title: x.p.title, company: x.p.company, location: x.p.location,
        salary: x.stated, low: x.eur[0], high: x.eur[1],
        similarity: Number(r.score.toFixed(3)),
      };
    });

  if (comparators.length < 3) {
    return { n: comparators.length, currency: 'EUR', comparators };
  }

  const mids = comparators.map(c => (c.low + c.high) / 2).sort((a, b) => a - b);
  const q = (p: number) => Math.round(mids[Math.floor(p * (mids.length - 1))] / 1000) * 1000;

  return {
    n: comparators.length,
    p25: q(0.25),
    median: q(0.5),
    p75: q(0.75),
    currency: 'EUR',
    comparators,
  };
}
