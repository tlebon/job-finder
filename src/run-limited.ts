import { fetchAllJobs } from './sources/index.js';
import { filterJob, detectJobType } from './filters/jobFilter.js';
import { generateCoverLetter, checkRelevance, getLessons } from './ai/coverLetter.js';
import { appendJobs, getExistingJobUrls, ensureSheetHeaders, rawJobToJob } from './storage/sheets.js';
import type { RawJob, Job } from './types.js';

const LIMIT = 12; // Top 10 + a couple standouts

async function runLimited() {
  console.log('🔍 Job Finder - Limited Run (Top Jobs Only)\n');

  // Fetch all jobs
  const allJobs = await fetchAllJobs();

  // Filter and score
  const scored: { job: RawJob; score: number; criteria: string[] }[] = [];

  for (const job of allJobs) {
    const result = filterJob(job);
    if (result.passed) {
      scored.push({
        job,
        score: result.score,
        criteria: result.matchedCriteria,
      });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  console.log(`\nTotal passing jobs: ${scored.length}`);
  console.log(`Processing top ${LIMIT} jobs...\n`);

  // Ensure headers exist
  await ensureSheetHeaders();

  // Get existing job URLs to avoid duplicates
  const existingUrls = await getExistingJobUrls();

  // Process top jobs
  const topJobs = scored.slice(0, LIMIT);
  const processedJobs: Job[] = [];
  let skippedRelevance = 0;
  let skippedDuplicate = 0;

  for (let i = 0; i < topJobs.length; i++) {
    const { job, score, criteria } = topJobs[i];

    // Skip if already in sheet
    if (existingUrls.has(job.url)) {
      console.log(`[${i + 1}/${LIMIT}] SKIP (duplicate): ${job.title} @ ${job.company}`);
      skippedDuplicate++;
      continue;
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${i + 1}/${LIMIT}] ${job.title} @ ${job.company}`);
    console.log(`  Score: ${score} | ${criteria.join(' | ')}`);
    console.log(`  Location: ${job.location}`);
    console.log(`  URL: ${job.url}`);

    // Detect job type for cover letter customization
    const jobType = detectJobType(job);
    const typeStr = [
      jobType.isWeb3 ? 'Web3' : '',
      jobType.isPrivacy ? 'Privacy' : '',
      jobType.isEM ? 'EM' : 'IC',
    ].filter(Boolean).join('/');
    console.log(`  Type: ${typeStr}`);

    // Check relevance with AI first
    console.log('\n  [AI] Checking relevance...');
    const relevanceContext = {
      jobTitle: job.title,
      company: job.company,
      location: job.location,
      jobDescription: job.description,
      isWeb3Role: jobType.isWeb3,
      isPrivacyRole: jobType.isPrivacy,
      isEMRole: jobType.isEM,
    };

    const relevance = await checkRelevance(relevanceContext);
    console.log(`  [AI] Relevant: ${relevance.relevant ? '✅ YES' : '❌ NO'}`);
    console.log(`  [AI] Reason: ${relevance.reason}`);

    if (!relevance.relevant) {
      console.log(`  SKIPPING - AI determined not relevant`);
      skippedRelevance++;
      continue;
    }

    // Generate cover letter
    let coverLetter = '';
    try {
      coverLetter = await generateCoverLetter(relevanceContext);
    } catch (error) {
      console.error(`  ERROR generating cover letter:`, error);
      coverLetter = '[Error generating cover letter]';
    }

    // Create job record
    const processedJob = rawJobToJob(job, coverLetter);
    processedJob.score = score;
    processedJobs.push(processedJob);
  }

  // Save to Google Sheets
  if (processedJobs.length > 0) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 Saving ${processedJobs.length} jobs to Google Sheets...`);
    await appendJobs(processedJobs);
    console.log('✅ Done!');
  } else {
    console.log('\nNo new jobs to save.');
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 SUMMARY:`);
  console.log(`  - Processed: ${processedJobs.length} jobs`);
  console.log(`  - Skipped (duplicate): ${skippedDuplicate}`);
  console.log(`  - Skipped (not relevant): ${skippedRelevance}`);

  // Show accumulated lessons from the run
  const lessons = getLessons();
  if (lessons.length > 0) {
    console.log(`\n🧠 LESSONS LEARNED (${lessons.length} total):`);
    lessons.forEach((lesson, i) => {
      console.log(`  ${i + 1}. ${lesson}`);
    });
  }
}

runLimited().catch(console.error);
