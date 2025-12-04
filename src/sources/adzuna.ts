import type { RawJob } from '../types.js';

interface AdzunaJob {
  id: string;
  title: string;
  company: { display_name: string };
  location: { display_name: string };
  redirect_url: string;
  description: string;
  category: { label: string };
}

interface AdzunaResponse {
  results: AdzunaJob[];
  count: number;
}

// Adzuna API requires app_id and app_key
// Sign up at https://developer.adzuna.com/
export async function fetchAdzunaJobs(appId?: string, appKey?: string): Promise<RawJob[]> {
  if (!appId || !appKey) {
    console.log('Adzuna: Skipping (no API credentials)');
    return [];
  }

  const jobs: RawJob[] = [];
  const countries = ['de', 'nl', 'gb', 'at', 'pt', 'es', 'fr', 'it', 'be', 'ch']; // Germany, Netherlands, UK, Austria, Portugal, Spain, France, Italy, Belgium, Switzerland
  const searchTerms = ['react developer', 'frontend developer', 'fullstack developer'];

  try {
    console.log('Fetching Adzuna jobs...');

    for (const country of countries) {
      for (const what of searchTerms) {
        const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/1`);
        url.searchParams.set('app_id', appId);
        url.searchParams.set('app_key', appKey);
        url.searchParams.set('what', what);
        url.searchParams.set('results_per_page', '50');
        url.searchParams.set('content-type', 'application/json');

        const response = await fetch(url.toString());

        if (!response.ok) {
          console.error(`Adzuna API (${country}) returned ${response.status}`);
          continue;
        }

        const data = await response.json() as AdzunaResponse;

        for (const job of data.results || []) {
          jobs.push({
            title: job.title,
            company: job.company?.display_name || 'Unknown',
            location: job.location?.display_name || country.toUpperCase(),
            url: job.redirect_url,
            description: job.description || '',
            source: 'adzuna',
          });
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 200));
      }
    }

    console.log(`Found ${jobs.length} jobs from Adzuna`);
    return jobs;
  } catch (error) {
    console.error('Error fetching Adzuna jobs:', error);
    return [];
  }
}
