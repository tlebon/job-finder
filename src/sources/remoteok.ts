import type { RawJob } from '../types.js';
import { jobSources } from '../config.js';

interface RemoteOKJob {
  id: string;
  slug: string;
  company: string;
  position: string;
  tags: string[];
  location: string;
  description: string;
  url: string;
  apply_url?: string;
}

export async function fetchRemoteOKJobs(): Promise<RawJob[]> {
  try {
    console.log('Fetching RemoteOK jobs...');

    const response = await fetch(jobSources.remoteOK, {
      headers: {
        'User-Agent': 'job-finder-bot/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`RemoteOK API returned ${response.status}`);
    }

    const data = await response.json() as (RemoteOKJob | { legal: string })[];

    // First item is legal notice, skip it
    const jobs = data.slice(1) as RemoteOKJob[];

    const rawJobs: RawJob[] = jobs
      .filter(job => job.position && job.company)
      .map(job => ({
        title: job.position,
        company: job.company,
        location: job.location || 'Remote',
        url: job.apply_url || job.url || `https://remoteok.com/l/${job.slug}`,
        description: job.description || job.tags?.join(', ') || '',
        source: 'remoteok' as const,
      }));

    console.log(`Found ${rawJobs.length} jobs from RemoteOK`);
    return rawJobs;
  } catch (error) {
    console.error('Error fetching RemoteOK jobs:', error);
    return [];
  }
}
