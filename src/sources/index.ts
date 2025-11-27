import type { RawJob } from '../types.js';
import { env } from '../config.js';
import { fetchIndeedJobs } from './indeed.js';
import { fetchRemoteOKJobs } from './remoteok.js';
import { fetchArbeitnowJobs } from './arbeitnow.js';
import { fetchAdzunaJobs } from './adzuna.js';
import { fetchHNWhoIsHiringJobs } from './hn-whoishiring.js';
import { fetchJSearchJobs } from './jsearch.js';
import { fetch80000HoursJobs } from './80000hours.js';
import { fetchApifyLinkedInJobs } from './apify-linkedin.js';

interface SourceResult {
  name: string;
  jobs: RawJob[];
}

export async function fetchAllJobs(): Promise<RawJob[]> {
  console.log('Fetching jobs from all sources...\n');

  // Free sources (always run)
  const freeSourcePromises: Promise<SourceResult>[] = [
    fetchIndeedJobs().then(jobs => ({ name: 'Indeed', jobs })),
    fetchRemoteOKJobs().then(jobs => ({ name: 'RemoteOK', jobs })),
    fetchArbeitnowJobs().then(jobs => ({ name: 'Arbeitnow', jobs })),
    fetchHNWhoIsHiringJobs().then(jobs => ({ name: 'HN Who\'s Hiring', jobs })),
    fetch80000HoursJobs().then(jobs => ({ name: '80,000 Hours', jobs })),
  ];

  // Paid/optional sources (only run if configured)
  const optionalSourcePromises: Promise<SourceResult>[] = [];

  if (env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY) {
    optionalSourcePromises.push(
      fetchAdzunaJobs(env.ADZUNA_APP_ID, env.ADZUNA_APP_KEY)
        .then(jobs => ({ name: 'Adzuna', jobs }))
    );
  }

  if (env.RAPIDAPI_KEY) {
    optionalSourcePromises.push(
      fetchJSearchJobs(env.RAPIDAPI_KEY)
        .then(jobs => ({ name: 'JSearch', jobs }))
    );
  }

  if (env.APIFY_TOKEN) {
    optionalSourcePromises.push(
      fetchApifyLinkedInJobs(env.APIFY_TOKEN)
        .then(jobs => ({ name: 'LinkedIn (Apify)', jobs }))
    );
  }

  // Run all sources in parallel
  const allPromises = [...freeSourcePromises, ...optionalSourcePromises];
  const results = await Promise.all(allPromises);

  // Aggregate and dedupe
  const allJobs: RawJob[] = [];
  const seenUrls = new Set<string>();

  console.log('\n--- Source Results ---');

  for (const { name, jobs } of results) {
    let added = 0;
    for (const job of jobs) {
      if (!seenUrls.has(job.url)) {
        seenUrls.add(job.url);
        allJobs.push(job);
        added++;
      }
    }
    console.log(`  ${name}: ${jobs.length} fetched, ${added} unique`);
  }

  console.log(`\nTotal unique jobs: ${allJobs.length}`);

  return allJobs;
}
