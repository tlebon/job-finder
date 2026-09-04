import type { RawJob, FilterResult } from '../types.js';
import { filterConfig, matchedTechCategories } from '../config.js';
import { getBlocklist } from '../storage/db.js';

/** Bounded so a long job description cannot run the tech score away. */
const TECH_CATEGORY_CAP = 4;
const TECH_CATEGORY_POINTS = 8;

function matchesAny(text: string, patterns: RegExp[]): string[] {
  const matches: string[] = [];
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      matches.push(pattern.source);
    }
  }
  return matches;
}

/**
 * US roles are no longer excluded: Tim is a US citizen and his stated fallback
 * if the Berlin search doesn't land is Berkeley. AI-safety work in particular is
 * concentrated in the Bay Area, and the old exclusion was dropping ~90 of 201
 * jobs from the 80,000 Hours board, including Anthropic Alignment Science.
 *
 * Kept as a signal rather than a gate, so the UI can say "this needs a move".
 */
function requiresRelocation(location: string, description: string): boolean {
  const locationLower = location.toLowerCase();
  const fullText = `${location} ${description}`.toLowerCase();

  // US cities/states that indicate on-site
  const usCities = /\b(san francisco|new york|nyc|seattle|austin|boston|chicago|denver|los angeles|miami|atlanta|portland|silicon valley|palo alto|mountain view)\b/i;
  const usStates = /\b(california|texas|colorado|washington|massachusetts|georgia|florida|illinois|new york state)\b/i;

  // Check if location is a US city/state
  const isUSLocation = usCities.test(locationLower) || usStates.test(locationLower);

  // Check if remote is mentioned
  const hasRemote = /\b(remote|distributed|work from home|wfh|anywhere|worldwide|global)\b/i.test(fullText);

  // Exclude if US location WITHOUT remote option
  if (isUSLocation && !hasRemote) {
    return true;
  }

  // Also exclude hybrid US jobs (some on-site required)
  if (isUSLocation && /\bhybrid\b/i.test(fullText) && !/remote/i.test(fullText)) {
    return true;
  }

  return false;
}

function isBackendOnly(title: string, _description: string): boolean {
  const titleLower = title.toLowerCase();

  // Check if title explicitly says "backend" or "back end" or "back-end"
  const hasBackendInTitle = /\b(backend|back-end|back end)\b/i.test(title);
  const hasFrontendInTitle = /\b(frontend|front-end|front end)\b/i.test(title);
  const hasFullstackInTitle = /\b(fullstack|full-stack|full stack)\b/i.test(title);

  // Also check for language-specific backend indicators
  const hasBackendLang = /\b(golang|go developer|java developer|python developer|ruby|rust|scala|kotlin|c\+\+|\.net|asp\.net)\b/i.test(title);

  // Only exclude if title explicitly says "backend" and NOT frontend/fullstack
  if ((hasBackendInTitle || hasBackendLang) && !hasFrontendInTitle && !hasFullstackInTitle) {
    // Additional check: some titles like "Backend & Frontend" should pass
    if (titleLower.includes('&') || titleLower.includes('and') || titleLower.includes('/')) {
      // Title has multiple parts, check if frontend is mentioned anywhere
      if (/front/i.test(title)) {
        return false;
      }
    }
    return true;
  }

  return false;
}

export function filterJob(job: RawJob): FilterResult {
  const { title, description, location, company } = job;
  const fullText = `${title} ${description} ${company}`;

  const matchedCriteria: string[] = [];
  let score = 0;

  // Check blocklist first (learned from NOT_FIT feedback)
  const blocklist = getBlocklist();

  // Check blocked companies
  const blockedCompany = blocklist.find(
    b => b.type === 'company' &&
    company.toLowerCase().includes(b.value.toLowerCase())
  );
  if (blockedCompany) {
    return {
      passed: false,
      score: 0,
      matchedCriteria: [`BLOCKED: Company "${blockedCompany.value}"`],
      categories: [],
    };
  }

  // Check blocked keywords in title
  const blockedKeyword = blocklist.find(
    b => b.type === 'keyword' &&
    title.toLowerCase().includes(b.value.toLowerCase())
  );
  if (blockedKeyword) {
    return {
      passed: false,
      score: 0,
      matchedCriteria: [`BLOCKED: Keyword "${blockedKeyword.value}"`],
      categories: [],
    };
  }

  // Check blocked title patterns
  const blockedPattern = blocklist.find(
    b => b.type === 'title_pattern' &&
    new RegExp(b.value, 'i').test(title)
  );
  if (blockedPattern) {
    return {
      passed: false,
      score: 0,
      matchedCriteria: [`BLOCKED: Pattern "${blockedPattern.value}"`],
      categories: [],
    };
  }

  // Check exclusions first
  const excludedMatches = matchesAny(title, filterConfig.excludeTitles);
  if (excludedMatches.length > 0) {
    return {
      passed: false,
      score: 0,
      matchedCriteria: [`EXCLUDED: ${excludedMatches.join(', ')}`],
      categories: [],
    };
  }

  // Check if backend-only
  if (isBackendOnly(title, description)) {
    return {
      passed: false,
      score: 0,
      matchedCriteria: ['EXCLUDED: Backend-only role'],
      categories: [],
    };
  }

  const needsRelocation = requiresRelocation(location, description);

  // Check title matches
  const titleMatches = matchesAny(title, filterConfig.includeTitles);
  if (titleMatches.length > 0) {
    matchedCriteria.push(`Title: ${titleMatches.join(', ')}`);
    score += titleMatches.length * 10;
  }

  // Tech is scored by distinct category, not by raw keyword count. Listing
  // react + typescript + redux is one signal, and counting each hit let verbose
  // job descriptions outscore terse ones for the same role.
  const techCats = matchedTechCategories(fullText);
  if (techCats.length > 0) {
    matchedCriteria.push(`Tech: ${techCats.join(', ')}`);
    score += Math.min(techCats.length, TECH_CATEGORY_CAP) * TECH_CATEGORY_POINTS;
  }

  // Check company type (privacy, blockchain, etc.)
  const companyTypeMatches = matchesAny(fullText, filterConfig.includeCompanyTypes);
  if (companyTypeMatches.length > 0) {
    matchedCriteria.push(`Domain: ${companyTypeMatches.join(', ')}`);
    score += companyTypeMatches.length * 8;
  }

  // Check location
  const locationMatches = matchesAny(location, filterConfig.includeLocations);
  if (locationMatches.length > 0) {
    matchedCriteria.push(`Location: ${locationMatches.join(', ')}`);
    score += 5;
  }

  // Boost Berlin jobs (no relocation needed)
  if (/berlin/i.test(location)) {
    matchedCriteria.push('Berlin bonus');
    score += 15;
  }

  // Apply boost keywords
  const boostMatches = matchesAny(fullText, filterConfig.boostKeywords);
  if (boostMatches.length > 0) {
    matchedCriteria.push(`Boost: ${boostMatches.join(', ')}`);
    score += boostMatches.length * 3;
  }

  // Pass criteria (any of these):

  // 1. Title match + location match (traditional)
  const titleAndLocation = titleMatches.length > 0 && locationMatches.length > 0;

  // 2. Domain match (blockchain/privacy company with relevant tech)
  const domainMatch = techCats.length > 0 && companyTypeMatches.length > 0 && locationMatches.length > 0;

  // 3. LENIENT: 2+ distinct tech categories + location. Stricter than the old
  // "2+ keywords" rule, which two synonyms could satisfy.
  const strongTechMatch = techCats.length >= 2 && locationMatches.length > 0;

  if (needsRelocation) {
    matchedCriteria.push('Requires relocation (US on-site)');
  }

  return {
    passed: titleAndLocation || domainMatch || strongTechMatch,
    score,
    matchedCriteria,
    categories: techCats,
    requiresRelocation: needsRelocation,
  };
}

export function filterJobs(jobs: RawJob[]): { passed: RawJob[]; filtered: number } {
  const passed: RawJob[] = [];
  let filtered = 0;

  for (const job of jobs) {
    const result = filterJob(job);
    if (result.passed) {
      // Attach score and categories to the job for sorting and UI filters
      (job as RawJob & { score: number; categories: string[] }).score = result.score;
      (job as RawJob & { score: number; categories: string[] }).categories = result.categories;
      (job as RawJob & { requiresRelocation?: boolean }).requiresRelocation = result.requiresRelocation;
      passed.push(job);
    } else {
      filtered++;
    }
  }

  // Sort by score descending
  passed.sort((a, b) => {
    const scoreA = (a as RawJob & { score?: number }).score || 0;
    const scoreB = (b as RawJob & { score?: number }).score || 0;
    return scoreB - scoreA;
  });

  console.log(`\nFiltering results:`);
  console.log(`  - Passed: ${passed.length}`);
  console.log(`  - Filtered out: ${filtered}`);

  return { passed, filtered };
}

// Helper to detect job type for cover letter customization
export function detectJobType(job: RawJob): {
  isWeb3: boolean;
  isPrivacy: boolean;
  isEM: boolean;
} {
  const fullText = `${job.title} ${job.description} ${job.company}`;

  const web3Patterns = [/blockchain/i, /web3/i, /crypto/i, /defi/i, /nft/i, /smart contract/i];
  const privacyPatterns = [/encrypt/i, /e2e/i, /privacy/i, /secure messaging/i];
  const emPatterns = [/engineering manager/i, /eng\.?\s*manager/i, /\bem\b/i, /team lead/i];

  return {
    isWeb3: web3Patterns.some(p => p.test(fullText)),
    isPrivacy: privacyPatterns.some(p => p.test(fullText)),
    isEM: emPatterns.some(p => p.test(job.title)),
  };
}
