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

// Adzuna returns transient 503s under load. Without a retry, a single blip
// silently drops that country/search-term combination for the whole run, which
// is how a full sweep ends up returning only a fraction of the available jobs.
async function fetchWithRetry(url: string, label: string, attempts = 3): Promise<Response | null> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;

      // 4xx (bad credentials, bad query) won't improve on retry
      if (response.status >= 400 && response.status < 500) {
        console.error(`Adzuna API (${label}) returned ${response.status} - not retrying`);
        return null;
      }

      if (attempt === attempts) {
        console.error(`Adzuna API (${label}) returned ${response.status} after ${attempts} attempts`);
        return null;
      }
    } catch (error) {
      if (attempt === attempts) {
        console.error(`Adzuna API (${label}) failed after ${attempts} attempts:`, error);
        return null;
      }
    }

    // Exponential backoff: 500ms, 1000ms
    await new Promise(resolve => setTimeout(resolve, 500 * attempt));
  }
  return null;
}

// Adzuna API requires app_id and app_key
// Sign up at https://developer.adzuna.com/
export async function fetchAdzunaJobs(appId?: string, appKey?: string): Promise<RawJob[]> {
  if (!appId || !appKey) {
    console.log('Adzuna: Skipping (no API credentials)');
    return [];
  }

  const jobs: RawJob[] = [];
  // Adzuna supported countries (pt, es, be, ch not available)
  const countries = ['de', 'nl', 'gb', 'at', 'fr', 'it', 'pl']; // Germany, Netherlands, UK, Austria, France, Italy, Poland
  const searchTerms = ['react developer', 'frontend developer', 'fullstack developer'];

  // Data science / AI terms run against the highest-yield markets only.
  // Every country x term pair is one API call, and the cron runs 6x/day, so a
  // full 7-country sweep for these would roughly double daily Adzuna usage.
  const dsCountries = ['de', 'nl', 'gb'];
  const dsSearchTerms = ['data scientist', 'machine learning engineer'];

  // One API call per (country, term) pair
  const pairs: Array<{ country: string; what: string }> = [];
  for (const country of countries) {
    for (const what of searchTerms) pairs.push({ country, what });
  }
  for (const country of dsCountries) {
    for (const what of dsSearchTerms) pairs.push({ country, what });
  }

  try {
    console.log(`Fetching Adzuna jobs (${pairs.length} queries)...`);

    let failed = 0;

    for (const { country, what } of pairs) {
      const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/1`);
      url.searchParams.set('app_id', appId);
      url.searchParams.set('app_key', appKey);
      url.searchParams.set('what', what);
      url.searchParams.set('results_per_page', '50');
      url.searchParams.set('content-type', 'application/json');

      const response = await fetchWithRetry(url.toString(), `${country}/${what}`);
      if (!response) {
        failed++;
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

    if (failed > 0) {
      console.error(`Adzuna: ${failed}/${pairs.length} queries failed after retries`);
    }
    console.log(`Found ${jobs.length} jobs from Adzuna`);
    return jobs;
  } catch (error) {
    console.error('Error fetching Adzuna jobs:', error);
    return [];
  }
}
