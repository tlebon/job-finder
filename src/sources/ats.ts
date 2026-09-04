import type { RawJob } from '../types.js';
import { cleanJobDescription } from '../utils/jobText.js';

/**
 * Company ATS boards (Ashby, Greenhouse, Lever).
 *
 * AI-native companies mostly do not post to aggregators. Every company on Tim's
 * own shortlist - Perplexity, Granola, Zyphra, Langfuse, Arveum - was missing
 * from the database while Arbeitnow supplied 3231 generic listings. These three
 * platforms expose public JSON with no auth, keyed by company slug, so this is a
 * watchlist rather than a search: you say which companies matter, and get every
 * role they have open.
 */

export type AtsPlatform = 'ashby' | 'greenhouse' | 'lever';

export interface AtsCompany {
  platform: AtsPlatform;
  /** Slug as it appears in the board URL. */
  slug: string;
  /** Display name; falls back to the slug. */
  name?: string;
}

/**
 * Seeded from Tim's own open tabs and the AI-safety orgs on the 80,000 Hours
 * board. Add companies here rather than hoping an aggregator carries them.
 */
export const ATS_COMPANIES: AtsCompany[] = [
  // From Tim's shortlist
  { platform: 'ashby', slug: 'Perplexity', name: 'Perplexity' },
  { platform: 'ashby', slug: 'granola', name: 'Granola' },
  { platform: 'ashby', slug: 'zyphra', name: 'Zyphra' },
  { platform: 'ashby', slug: 'langfuse', name: 'Langfuse' },
  { platform: 'greenhouse', slug: 'anthropic', name: 'Anthropic' },
  { platform: 'greenhouse', slug: 'proton', name: 'Proton' },
  { platform: 'lever', slug: 'metr', name: 'METR' },
];

// Only verified slugs above - an unverified guess is a board that silently
// returns nothing. FAR AI and Transluce reach us via the 80,000 Hours board
// instead. To add a company, open its careers page and take the slug from the
// board URL, then confirm the endpoint returns jobs before committing it.

interface AshbyJob {
  title: string;
  location?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  jobUrl?: string;
  applyUrl?: string;
  isRemote?: boolean;
}

interface GreenhouseJob {
  title: string;
  location?: { name?: string };
  absolute_url?: string;
  content?: string;
}

interface LeverJob {
  text: string;
  categories?: { location?: string; team?: string };
  descriptionPlain?: string;
  description?: string;
  hostedUrl?: string;
}

async function fetchJson<T>(url: string, label: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'job-finder' } });
    if (!res.ok) {
      console.error(`  ${label}: HTTP ${res.status}`);
      return null;
    }
    return await res.json() as T;
  } catch (error) {
    console.error(`  ${label}: ${(error as Error).message}`);
    return null;
  }
}

async function fetchAshby(c: AtsCompany): Promise<RawJob[]> {
  const data = await fetchJson<{ jobs?: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${c.slug}`,
    `ashby/${c.slug}`
  );
  return (data?.jobs || []).map(j => ({
    title: j.title,
    company: c.name || c.slug,
    location: j.isRemote ? `Remote, ${j.location || ''}`.trim() : (j.location || 'Unknown'),
    url: j.jobUrl || j.applyUrl || '',
    description: cleanJobDescription(j.descriptionPlain || j.descriptionHtml || ''),
    source: 'ats',
  }));
}

async function fetchGreenhouse(c: AtsCompany): Promise<RawJob[]> {
  const data = await fetchJson<{ jobs?: GreenhouseJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs?content=true`,
    `greenhouse/${c.slug}`
  );
  return (data?.jobs || []).map(j => ({
    title: j.title,
    company: c.name || c.slug,
    location: j.location?.name || 'Unknown',
    url: j.absolute_url || '',
    description: cleanJobDescription(j.content || ''),
    source: 'ats',
  }));
}

async function fetchLever(c: AtsCompany): Promise<RawJob[]> {
  const data = await fetchJson<LeverJob[]>(
    `https://api.lever.co/v0/postings/${c.slug}?mode=json`,
    `lever/${c.slug}`
  );
  return (data || []).map(j => ({
    title: j.text,
    company: c.name || c.slug,
    location: j.categories?.location || 'Unknown',
    url: j.hostedUrl || '',
    description: cleanJobDescription(j.descriptionPlain || j.description || ''),
    source: 'ats',
  }));
}

export async function fetchAtsJobs(companies: AtsCompany[] = ATS_COMPANIES): Promise<RawJob[]> {
  console.log(`Fetching ATS boards (${companies.length} companies)...`);

  const jobs: RawJob[] = [];
  let failed = 0;

  for (const c of companies) {
    const fetcher =
      c.platform === 'ashby' ? fetchAshby :
      c.platform === 'greenhouse' ? fetchGreenhouse :
      fetchLever;

    const result = await fetcher(c);
    if (result.length === 0) failed++;
    jobs.push(...result.filter(j => j.url && j.title));

    // These are single-company endpoints, so the request count is small.
    await new Promise(r => setTimeout(r, 250));
  }

  if (failed > 0) {
    console.error(`  ${failed}/${companies.length} ATS boards returned nothing (slug may have changed)`);
  }

  const unique = Array.from(new Map(jobs.map(j => [j.url, j])).values());
  console.log(`Found ${unique.length} jobs from ATS boards`);
  return unique;
}
