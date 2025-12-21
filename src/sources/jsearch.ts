import type { RawJob } from '../types.js';
import fs from 'fs';
import path from 'path';

interface JSearchJob {
  job_id: string;
  job_title: string;
  employer_name: string;
  job_city: string;
  job_country: string;
  job_apply_link: string;
  job_description: string;
  job_is_remote: boolean;
}

interface JSearchResponse {
  status: string;
  data: JSearchJob[];
}

// Cache file to track last JSearch run
const CACHE_FILE = path.join(process.cwd(), '.jsearch-cache.json');
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

interface JSearchCache {
  lastRun: number;
}

function shouldRunJSearch(): boolean {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cache: JSearchCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      const elapsed = Date.now() - cache.lastRun;
      if (elapsed < CACHE_DURATION_MS) {
        const hoursRemaining = Math.round((CACHE_DURATION_MS - elapsed) / (60 * 60 * 1000));
        console.log(`JSearch: Skipping (ran ${Math.round(elapsed / (60 * 60 * 1000))}h ago, next run in ~${hoursRemaining}h)`);
        return false;
      }
    }
  } catch {
    // Cache file doesn't exist or is invalid, proceed with run
  }
  return true;
}

function updateJSearchCache(): void {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ lastRun: Date.now() }));
  } catch (err) {
    console.error('JSearch: Failed to write cache file:', err);
  }
}

// JSearch API via RapidAPI
// Sign up at https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
// Free tier: 200 requests/month (~6-7/day)
export async function fetchJSearchJobs(rapidApiKey?: string): Promise<RawJob[]> {
  if (!rapidApiKey || rapidApiKey === 'disabled') {
    console.log('JSearch: Skipping (no RapidAPI key or disabled)');
    return [];
  }

  // Check 24-hour cache to avoid excessive API usage
  if (!shouldRunJSearch()) {
    return [];
  }

  const jobs: RawJob[] = [];

  // Reduced queries to stay within free tier (200/month)
  // 3 queries × 1 run/day × 30 days = 90 requests/month (safe margin)
  const queries = [
    'react developer remote europe',
    'frontend developer germany portugal spain',
    'fullstack developer berlin lisbon barcelona',
  ];

  try {
    console.log(`Fetching JSearch jobs (${queries.length} queries)...`);

    for (const query of queries) {
      const url = new URL('https://jsearch.p.rapidapi.com/search');
      url.searchParams.set('query', query);
      url.searchParams.set('num_pages', '1');
      url.searchParams.set('date_posted', 'week'); // Last week only

      const response = await fetch(url.toString(), {
        headers: {
          'X-RapidAPI-Key': rapidApiKey,
          'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
        },
      });

      if (!response.ok) {
        console.error(`JSearch API returned ${response.status} for query: ${query}`);
        continue;
      }

      const data = await response.json() as JSearchResponse;

      for (const job of data.data || []) {
        const location = job.job_is_remote
          ? 'Remote'
          : [job.job_city, job.job_country].filter(Boolean).join(', ');

        jobs.push({
          title: job.job_title,
          company: job.employer_name,
          location,
          url: job.job_apply_link,
          description: job.job_description || '',
          source: 'jsearch',
        });
      }

      // Rate limit to avoid hitting API limits
      await new Promise(r => setTimeout(r, 500));
    }

    // Dedupe by URL
    const uniqueJobs = Array.from(
      new Map(jobs.map(j => [j.url, j])).values()
    );

    // Update cache after successful run
    updateJSearchCache();

    console.log(`Found ${uniqueJobs.length} jobs from JSearch`);
    return uniqueJobs;
  } catch (error) {
    console.error('Error fetching JSearch jobs:', error);
    return [];
  }
}
