import type { RawJob } from '../types.js';

interface ApifyLinkedInJob {
  title: string;
  companyName: string;
  location: string;
  jobUrl: string;
  description?: string;
  postedAt?: string;
}

interface ApifyRunOutput {
  items: ApifyLinkedInJob[];
}

// Apify LinkedIn Jobs Scraper
// Actor: https://apify.com/bebity/linkedin-jobs-scraper
// Sign up at https://apify.com/ and get API token

const LINKEDIN_ACTOR_ID = 'bebity~linkedin-jobs-scraper';

export async function fetchApifyLinkedInJobs(apifyToken?: string): Promise<RawJob[]> {
  if (!apifyToken) {
    console.log('Apify LinkedIn: Skipping (no API token)');
    return [];
  }

  const jobs: RawJob[] = [];

  // Search configurations
  const searches = [
    { keywords: 'react developer', location: 'Berlin, Germany' },
    { keywords: 'frontend developer', location: 'Berlin, Germany' },
    { keywords: 'fullstack developer', location: 'Amsterdam, Netherlands' },
    { keywords: 'react developer', location: 'European Union', remote: true },
    { keywords: 'web3 developer', location: 'European Union' },
    { keywords: 'typescript developer', location: 'Germany' },
  ];

  try {
    console.log('Fetching LinkedIn jobs via Apify...');

    for (const search of searches) {
      // Start actor run
      const runResponse = await fetch(
        `https://api.apify.com/v2/acts/${LINKEDIN_ACTOR_ID}/runs?token=${apifyToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            searchQueries: [search.keywords],
            locationQueries: [search.location],
            publishedAt: 'past week',
            rows: 25,
            ...(search.remote && { remote: true }),
          }),
        }
      );

      if (!runResponse.ok) {
        console.error(`Apify run failed: ${runResponse.status}`);
        continue;
      }

      const runData = await runResponse.json() as { data: { id: string } };
      const runId = runData.data.id;

      // Wait for completion (poll every 5 seconds, max 2 minutes)
      let attempts = 0;
      let completed = false;

      while (attempts < 24 && !completed) {
        await new Promise(r => setTimeout(r, 5000));

        const statusResponse = await fetch(
          `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`
        );
        const statusData = await statusResponse.json() as { data: { status: string } };

        if (statusData.data.status === 'SUCCEEDED') {
          completed = true;
        } else if (statusData.data.status === 'FAILED' || statusData.data.status === 'ABORTED') {
          console.error(`Apify run ${runId} failed`);
          break;
        }

        attempts++;
      }

      if (!completed) {
        console.log(`Apify run ${runId} timed out, skipping`);
        continue;
      }

      // Get results
      const resultsResponse = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${apifyToken}`
      );

      if (!resultsResponse.ok) {
        console.error(`Failed to get Apify results: ${resultsResponse.status}`);
        continue;
      }

      const results = await resultsResponse.json() as ApifyLinkedInJob[];

      for (const job of results) {
        if (!job.title || !job.jobUrl) continue;

        jobs.push({
          title: job.title,
          company: job.companyName || 'Unknown',
          location: job.location || search.location,
          url: job.jobUrl,
          description: job.description || '',
          source: 'linkedin',
        });
      }

      console.log(`Got ${results.length} jobs from search: ${search.keywords} in ${search.location}`);
    }

    // Dedupe by URL
    const uniqueJobs = Array.from(
      new Map(jobs.map(j => [j.url, j])).values()
    );

    console.log(`Found ${uniqueJobs.length} total LinkedIn jobs via Apify`);
    return uniqueJobs;
  } catch (error) {
    console.error('Error fetching Apify LinkedIn jobs:', error);
    return [];
  }
}
