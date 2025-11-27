import { fetchAllJobs } from './sources/index.js';
import { filterJob } from './filters/jobFilter.js';
import type { RawJob } from './types.js';

async function showTopJobs() {
  console.log('Fetching jobs...\n');
  const jobs = await fetchAllJobs();

  // Filter and score
  const scored: { job: RawJob; score: number; criteria: string[] }[] = [];

  for (const job of jobs) {
    const result = filterJob(job);
    if (result.passed) {
      scored.push({
        job,
        score: result.score,
        criteria: result.matchedCriteria,
      });
    }
  }

  // Sort by score
  scored.sort((a, b) => b.score - a.score);

  // Show top 30
  console.log('\n=== TOP 30 JOBS BY SCORE ===\n');
  for (let i = 0; i < Math.min(30, scored.length); i++) {
    const { job, score, criteria } = scored[i];
    console.log(`${i + 1}. [Score: ${score}] ${job.title}`);
    console.log(`   Company: ${job.company}`);
    console.log(`   Location: ${job.location}`);
    console.log(`   Source: ${job.source}`);
    console.log(`   Matched: ${criteria.join(' | ')}`);
    console.log(`   URL: ${job.url}`);
    console.log('');
  }

  console.log(`\nTotal passing jobs: ${scored.length}`);
}

showTopJobs().catch(console.error);
