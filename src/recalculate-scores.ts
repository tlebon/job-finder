import { db } from './storage/db.js';
import { filterConfig } from './config.js';

interface JobRow {
  id: string;
  title: string;
  description: string;
  location: string;
  company: string;
  score: number | null;
}

function matchesAny(text: string, patterns: RegExp[]): string[] {
  const matches: string[] = [];
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      matches.push(pattern.source);
    }
  }
  return matches;
}

function calculateScore(job: JobRow): number {
  const { title, description, location, company } = job;
  const fullText = `${title} ${description} ${company}`;
  let score = 0;

  // Check title matches
  const titleMatches = matchesAny(title, filterConfig.includeTitles);
  score += titleMatches.length * 10;

  // Check tech in description
  const techMatches = matchesAny(fullText, filterConfig.includeTech);
  score += techMatches.length * 5;

  // Check company type (privacy, blockchain, etc.)
  const companyTypeMatches = matchesAny(fullText, filterConfig.includeCompanyTypes);
  score += companyTypeMatches.length * 8;

  // Check location
  const locationMatches = matchesAny(location, filterConfig.includeLocations);
  if (locationMatches.length > 0) {
    score += 5;
  }

  // Boost Berlin jobs
  if (/berlin/i.test(location)) {
    score += 15;
  }

  // Apply boost keywords
  const boostMatches = matchesAny(fullText, filterConfig.boostKeywords);
  score += boostMatches.length * 3;

  return score;
}

async function main() {
  console.log('Recalculating scores for all jobs...\n');

  // Get all jobs
  const jobs = db.prepare('SELECT id, title, description, location, company, score FROM jobs').all() as JobRow[];
  console.log(`Found ${jobs.length} jobs to process\n`);

  // Prepare update statement
  const updateScore = db.prepare('UPDATE jobs SET score = ? WHERE id = ?');

  let updated = 0;
  let unchanged = 0;

  for (const job of jobs) {
    const newScore = calculateScore(job);
    const oldScore = job.score || 0;

    if (newScore !== oldScore) {
      updateScore.run(newScore, job.id);
      updated++;
      if (newScore > 0) {
        console.log(`  ${job.title} @ ${job.company}: ${oldScore} -> ${newScore} pts`);
      }
    } else {
      unchanged++;
    }
  }

  console.log(`\nDone!`);
  console.log(`  Updated: ${updated} jobs`);
  console.log(`  Unchanged: ${unchanged} jobs`);
}

main().catch(console.error);
