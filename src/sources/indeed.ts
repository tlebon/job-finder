import Parser from 'rss-parser';
import type { RawJob } from '../types.js';
import { jobSources } from '../config.js';

const parser = new Parser();

export async function fetchIndeedJobs(): Promise<RawJob[]> {
  const jobs: RawJob[] = [];

  for (const feedUrl of jobSources.indeedRSS) {
    try {
      console.log(`Fetching Indeed RSS: ${feedUrl}`);
      const feed = await parser.parseURL(feedUrl);

      for (const item of feed.items) {
        if (!item.title || !item.link) continue;

        // Indeed RSS format: "Job Title - Company - Location"
        const titleParts = item.title.split(' - ');
        const jobTitle = titleParts[0] || item.title;
        const company = titleParts[1] || 'Unknown Company';
        const location = titleParts[2] || 'Unknown Location';

        jobs.push({
          title: jobTitle.trim(),
          company: company.trim(),
          location: location.trim(),
          url: item.link,
          description: item.contentSnippet || item.content || '',
          source: 'indeed',
        });
      }

      console.log(`Found ${feed.items.length} jobs from ${feedUrl}`);
    } catch (error) {
      console.error(`Error fetching Indeed RSS ${feedUrl}:`, error);
    }
  }

  return jobs;
}
