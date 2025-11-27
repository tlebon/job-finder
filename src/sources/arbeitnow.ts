import type { RawJob } from '../types.js';

interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  tags: string[];
  location: string;
  created_at: number;
}

interface ArbeitnowResponse {
  data: ArbeitnowJob[];
  links: {
    next: string | null;
  };
}

export async function fetchArbeitnowJobs(): Promise<RawJob[]> {
  const jobs: RawJob[] = [];

  try {
    console.log('Fetching Arbeitnow jobs...');

    // Fetch multiple pages
    let page = 1;
    const maxPages = 3;

    while (page <= maxPages) {
      const url = `https://www.arbeitnow.com/api/job-board-api?page=${page}`;
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'job-finder-bot/1.0',
        },
      });

      if (!response.ok) {
        console.error(`Arbeitnow API returned ${response.status}`);
        break;
      }

      const data = await response.json() as ArbeitnowResponse;

      if (!data.data || data.data.length === 0) break;

      for (const job of data.data) {
        jobs.push({
          title: job.title,
          company: job.company_name,
          location: job.remote ? 'Remote' : job.location,
          url: job.url || `https://www.arbeitnow.com/view/${job.slug}`,
          description: job.description + '\n\nTags: ' + job.tags.join(', '),
          source: 'arbeitnow',
        });
      }

      if (!data.links?.next) break;
      page++;
    }

    console.log(`Found ${jobs.length} jobs from Arbeitnow`);
    return jobs;
  } catch (error) {
    console.error('Error fetching Arbeitnow jobs:', error);
    return [];
  }
}
