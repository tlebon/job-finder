import type { RawJob } from '../types.js';

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

// JSearch API via RapidAPI
// Sign up at https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
export async function fetchJSearchJobs(rapidApiKey?: string): Promise<RawJob[]> {
  if (!rapidApiKey) {
    console.log('JSearch: Skipping (no RapidAPI key)');
    return [];
  }

  const jobs: RawJob[] = [];

  // Search queries for relevant jobs
  const queries = [
    'react developer europe',
    'frontend developer berlin',
    'fullstack developer remote europe',
    'typescript developer germany',
    'web3 developer',
    'blockchain developer europe',
  ];

  try {
    console.log('Fetching JSearch jobs...');

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

    console.log(`Found ${uniqueJobs.length} jobs from JSearch`);
    return uniqueJobs;
  } catch (error) {
    console.error('Error fetching JSearch jobs:', error);
    return [];
  }
}
