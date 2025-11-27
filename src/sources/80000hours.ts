import type { RawJob } from '../types.js';

interface AlgoliaHit {
  objectID: string;
  title: string;
  org_name: string;
  locations_str: string;
  url_external: string;
  description_short?: string;
  tags_area?: string[];
  tags_role_type?: string[];
  is_remote?: boolean;
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
  nbHits: number;
}

// 80,000 Hours uses Algolia - public credentials from their job board
const ALGOLIA_APP_ID = 'W6KM1UDIB3';
const ALGOLIA_API_KEY = 'd1d7f2c8696e7b36837d5ed337c4a319';
const ALGOLIA_INDEX = 'jobs_prod_super_ranked';

export async function fetch80000HoursJobs(): Promise<RawJob[]> {
  const jobs: RawJob[] = [];

  try {
    console.log('Fetching 80,000 Hours jobs...');

    // Search for tech-related roles
    const queries = [
      'software engineer',
      'frontend',
      'fullstack',
      'web developer',
      'engineering',
      'react',
      'typescript',
    ];

    for (const query of queries) {
      const url = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Algolia-Application-Id': ALGOLIA_APP_ID,
          'X-Algolia-API-Key': ALGOLIA_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          hitsPerPage: 50,
          attributesToRetrieve: [
            'objectID',
            'title',
            'org_name',
            'locations_str',
            'url_external',
            'description_short',
            'tags_area',
            'tags_role_type',
            'is_remote',
          ],
        }),
      });

      if (!response.ok) {
        console.error(`80000 Hours Algolia returned ${response.status}`);
        continue;
      }

      const data = await response.json() as AlgoliaResponse;

      for (const hit of data.hits || []) {
        const location = hit.is_remote
          ? 'Remote'
          : hit.locations_str || 'Unknown';

        const tags = [...(hit.tags_area || []), ...(hit.tags_role_type || [])];

        jobs.push({
          title: hit.title,
          company: hit.org_name,
          location,
          url: hit.url_external || `https://jobs.80000hours.org/job/${hit.objectID}`,
          description: (hit.description_short || '') + '\n\nTags: ' + tags.join(', '),
          source: '80000hours',
        });
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 200));
    }

    // Dedupe by URL
    const uniqueJobs = Array.from(
      new Map(jobs.map(j => [j.url, j])).values()
    );

    console.log(`Found ${uniqueJobs.length} jobs from 80,000 Hours`);
    return uniqueJobs;
  } catch (error) {
    console.error('Error fetching 80,000 Hours jobs:', error);
    return [];
  }
}
