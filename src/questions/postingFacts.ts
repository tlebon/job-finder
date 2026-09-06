/**
 * The facts about a posting you need in front of you while answering its form.
 *
 * Writing "what are your salary expectations?" without seeing what the posting
 * states, where the role is, or what the company does is answering blind - and
 * that was exactly the page's first version.
 *
 * Salary is stated in about 15% of postings and is worth pulling when it is
 * there: "$200K - $350K" or "Salary EUR 90K - 160K" are formulaic enough for a
 * regex, and no negation is involved - which is where regex beats embeddings.
 */

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
