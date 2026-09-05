import { fetchAllJobs } from './sources/index.js';
import { filterJobs } from './filters/jobFilter.js';
import { recordRejects, rejectStats } from './storage/rejects.js';
import { getExistingJobUrls, getExistingJobSignatures, appendJobs, rawJobToJob, updateJobWithAIReview, updateJobStatus, getProfile } from './storage/db.js';
import { notifyNewJobs, notifyError } from './notifications/telegram.js';
import { reviewCandidates } from './ai/reviewCandidates.js';
import { findUnreviewed, reviewAndPersist } from './review/backlog.js';
import { env } from './config.js';
import type { Job, RawJob } from './types.js';

/** Bounded so a large backlog drains over several runs rather than in one bill. */
const BACKLOG_PER_RUN = 100;

/**
 * No source restriction. An earlier version skipped adzuna on a measured 8%
 * good rate, but that came from a sample drawn highest-score-first; over the
 * full labelled set adzuna runs 28% good, above the 21% base rate. 80000hours
 * is the one source that holds up as exceptional either way, at 3.30x.
 */
const BACKLOG_SOURCES = undefined;

/**
 * Only spend review on jobs the model ranks at least this highly.
 *
 * On 200 held-out rows the top 30% by model score held 87.5% of the jobs Tim
 * would consider. Reviewing everything buys the last eighth at ten times the
 * cost, which over one day came to about 20 euro with nothing visible to show
 * for it.
 */
const BACKLOG_MIN_MODEL = 0.15;

// Normalize title for duplicate detection within batch
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(m\/w\/[dx*]\)/gi, '')
    .replace(/\(all genders?\)/gi, '')
    .replace(/\(remote\)/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

// De-duplicate jobs within the same batch (different sources, same job)
function deduplicateBatch(jobs: RawJob[]): RawJob[] {
  const seen = new Set<string>();
  const unique: RawJob[] = [];

  for (const job of jobs) {
    const signature = `${job.company.toLowerCase()}|${normalizeTitle(job.title)}`;
    if (!seen.has(signature)) {
      seen.add(signature);
      unique.push(job);
    }
  }

  const removed = jobs.length - unique.length;
  if (removed > 0) {
    console.log(`Removed ${removed} duplicates within batch`);
  }

  return unique;
}

const WEB_URL = 'http://localhost:3000/candidates';

async function main() {
  console.log('🔍 Job Finder - Starting...\n');
  console.log(`Mode: ${env.DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  try {
    // Step 1: Fetch jobs from all sources
    const rawJobs = await fetchAllJobs();

    if (rawJobs.length === 0) {
      console.log('\nNo jobs found from any source. Exiting.');
      return;
    }

    // Step 2: Filter jobs
    const { passed: filteredJobs, rejected } = filterJobs(rawJobs);

    // Record what the gate turned away. Previously these were counted and
    // dropped, so the gate's recall could not be measured without re-fetching
    // every source, and a model trained on the stored corpus learned from
    // survivors while being asked to rank the whole stream.
    if (!env.DRY_RUN && rejected.length > 0) {
      const stored = recordRejects(rejected);
      const stats = rejectStats();
      console.log(`  Recorded ${stored} new rejects (${stats.total} known across ${stats.sources} sources)`);
    }

    if (filteredJobs.length === 0) {
      console.log('\nNo jobs passed the filter. Exiting.');
      return;
    }

    // Step 3: De-duplicate within batch (same job from different sources)
    const dedupedJobs = deduplicateBatch(filteredJobs);

    // Step 4: Remove duplicates (already in database by URL or company+title)
    let existingUrls = new Set<string>();
    let existingSignatures = new Set<string>();
    if (!env.DRY_RUN) {
      existingUrls = getExistingJobUrls();
      existingSignatures = getExistingJobSignatures();
    }

    const newJobs = dedupedJobs.filter(job => {
      // Check URL
      if (existingUrls.has(job.url)) return false;
      // Check company + normalized title
      const signature = `${job.company.toLowerCase()}|${normalizeTitle(job.title)}`;
      if (existingSignatures.has(signature)) return false;
      return true;
    });

    console.log(`\nNew jobs (not in database): ${newJobs.length}`);

    if (newJobs.length === 0) {
      console.log('No new jobs to process. Exiting.');
      return;
    }

    // Step 4: Convert to PENDING jobs (no cover letter generation)
    console.log('\nSaving candidates for review...');
    const pendingJobs: Job[] = newJobs.map(rawJob =>
      rawJobToJob(rawJob, undefined, 'PENDING')
    );

    // Log candidates ranked by score
    console.log('\nNew candidates:');
    pendingJobs.forEach((job, i) => {
      const score = (job as Job & { score?: number }).score || 0;
      console.log(`  ${i + 1}. [${score}pts] ${job.title} @ ${job.company} (${job.location})`);
    });

    // Step 5: Save to SQLite database as PENDING
    if (!env.DRY_RUN) {
      appendJobs(pendingJobs);
    } else {
      console.log('\n[DRY RUN] Would save these candidates as PENDING');
    }

    // Step 5.5: AI Review of new candidates
    console.log('\n🤖 Running AI review of candidates...');
    const profile = getProfile();
    if (profile && !env.DRY_RUN) {
      const reviewResults = await reviewCandidates(pendingJobs, profile);

      // Apply results
      let autoDismissed = 0;
      for (const result of reviewResults) {
        if (result.suggestion === 'AUTO_DISMISS') {
          updateJobStatus(result.jobId, 'NOT_FIT', 'ai');
          autoDismissed++;
        }
        updateJobWithAIReview(result);
      }

      if (autoDismissed > 0) {
        console.log(`  [AI] Auto-dismissed ${autoDismissed} jobs as NOT_FIT`);
      }

      // Step 5.6: drain any backlog. Review has only ever run over the batch a
      // scrape brought in, so a job that arrived any other way - restored from
      // NOT_FIT, un-archived, or caught in a run a deploy rollover killed - kept
      // no verdict and sorted into the middle of the list carrying nothing.
      const backlog = findUnreviewed({
        limit: BACKLOG_PER_RUN,
        sources: BACKLOG_SOURCES,
        minModelScore: BACKLOG_MIN_MODEL,
      });
      if (backlog.length > 0) {
        console.log(`\n🤖 Reviewing ${backlog.length} previously unreviewed jobs...`);
        const tally = await reviewAndPersist(backlog, profile,
          (done, total) => console.log(`  [AI] backlog ${done}/${total}`));
        console.log(`  [AI] Backlog: ${tally.STRONG_FIT} strong, ${tally.GOOD_FIT} good, ` +
          `${tally.MAYBE} maybe, ${tally.AUTO_DISMISS} dismissed`);
      }
    } else if (!profile) {
      console.log('  [AI] No profile configured, skipping AI review');
      console.log('  [AI] Set up your profile at http://localhost:3000/settings');
    } else {
      console.log('  [DRY RUN] Would run AI review of candidates');
    }

    // Step 6: Send notification with link to review candidates
    if (!env.DRY_RUN && pendingJobs.length > 0) {
      await notifyNewJobs(
        pendingJobs.length,
        WEB_URL,
        pendingJobs.slice(0, 5).map(j => ({ title: j.title, company: j.company }))
      );
    }

    console.log('\n✅ Job Finder completed successfully!');
    console.log(`   Found: ${pendingJobs.length} new candidates for review`);
    console.log(`   Review at: ${WEB_URL}`);
  } catch (error) {
    console.error('\n❌ Job Finder failed:', error);

    if (!env.DRY_RUN) {
      await notifyError(String(error));
    }

    process.exit(1);
  }
}

main();
