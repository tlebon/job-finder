import type { RawJob } from '../types.js';

/**
 * 80,000 Hours job board (Algolia-backed).
 *
 * Their index was renamed at some point: org_name -> company_name, and
 * locations_str -> the card_locations / tags_city / tags_location_80k arrays.
 * The old parser kept requesting the retired names, so every job came back with
 * company undefined and location "Unknown". Since every filter pass rule
 * requires a location match, all 106 results per run were silently discarded.
 */

interface AlgoliaHit {
  objectID: string;
  title: string;
  company_name?: string;
  company?: { name?: string };
  card_locations?: string[];
  tags_city?: string[];
  tags_country?: string[];
  tags_location_80k?: string[];
  tags_location_type?: string[];
  url_external?: string;
  description?: string;
  description_short?: string;
  tags_area?: string[];
  tags_role_type?: string[];
  tags_skill?: string[];
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
  nbHits: number;
}

const ALGOLIA_APP_ID = 'W6KM1UDIB3';
const ALGOLIA_API_KEY = 'd1d7f2c8696e7b36837d5ed337c4a319';
const ALGOLIA_INDEX = 'jobs_prod_super_ranked';

/** Location arrives as several overlapping arrays; join what's there. */
function resolveLocation(hit: AlgoliaHit): string {
  const parts = [
    ...(hit.card_locations || []),
    ...(hit.tags_city || []),
    ...(hit.tags_country || []),
    ...(hit.tags_location_80k || []),
  ];

  const isRemote = (hit.tags_location_type || []).some(t => /remote/i.test(t));
  const unique = Array.from(new Set(parts.filter(Boolean)));

  if (isRemote) unique.unshift('Remote');
  return unique.length ? unique.join(', ') : 'Unknown';
}

export async function fetch80000HoursJobs(): Promise<RawJob[]> {
  const jobs: RawJob[] = [];

  try {
    console.log('Fetching 80,000 Hours jobs...');

    // Weighted toward what this board is actually good for: AI safety and
    // research engineering, not generic frontend work.
    const queries = [
      'software engineer',
      'research engineer',
      'machine learning engineer',
      'AI safety',
      'evals',
      'member of technical staff',
      'fullstack',
      'infrastructure engineer',
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
        // No attributesToRetrieve: pinning a field list is what let the rename
        // go unnoticed. Taking the whole hit means a future rename degrades
        // one field instead of silently emptying every job.
        body: JSON.stringify({ query, hitsPerPage: 50 }),
      });

      if (!response.ok) {
        console.error(`80,000 Hours Algolia returned ${response.status}`);
        continue;
      }

      const data = await response.json() as AlgoliaResponse;

      for (const hit of data.hits || []) {
        const company = hit.company_name || hit.company?.name;
        if (!company || !hit.title) continue;

        const tags = [
          ...(hit.tags_area || []),
          ...(hit.tags_role_type || []),
          ...(hit.tags_skill || []),
        ];

        jobs.push({
          title: hit.title,
          company,
          location: resolveLocation(hit),
          url: hit.url_external || `https://jobs.80000hours.org/job/${hit.objectID}`,
          description: (hit.description || hit.description_short || '') +
            (tags.length ? `\n\nTags: ${tags.join(', ')}` : ''),
          source: '80000hours',
        });
      }

      await new Promise(r => setTimeout(r, 200));
    }

    const uniqueJobs = Array.from(new Map(jobs.map(j => [j.url, j])).values());

    const unknownLocations = uniqueJobs.filter(j => j.location === 'Unknown').length;
    if (unknownLocations > uniqueJobs.length / 2) {
      console.error(
        `80,000 Hours: ${unknownLocations}/${uniqueJobs.length} jobs have no location - ` +
        `the Algolia schema may have changed again.`
      );
    }

    console.log(`Found ${uniqueJobs.length} jobs from 80,000 Hours`);
    return uniqueJobs;
  } catch (error) {
    console.error('Error fetching 80,000 Hours jobs:', error);
    return [];
  }
}
