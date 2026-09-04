#!/usr/bin/env tsx
/**
 * Re-review candidates whose AI review failed.
 *
 * When the Anthropic API is unavailable (e.g. exhausted credit), reviewBatch()
 * falls back to MAYBE with reasoning 'Review failed, needs manual evaluation'
 * and scoreAdjustment 0. Those jobs look reviewed (ai_reviewed = 1) but never
 * were, so they never surface as STRONG_FIT/GOOD_FIT and stay invisible to the
 * new-jobs summary.
 *
 * Because the failed pass applied a score adjustment of 0, re-running these is
 * safe — there is no score to double-count.
 *
 * Usage:
 *   npx tsx src/rereview-failed.ts --dry-run
 *   npx tsx src/rereview-failed.ts --confirm [--limit=100] [--max-age-days=30]
 *   npx tsx src/rereview-failed.ts --confirm --since=2026-09-04 --include-dismissed
 *
 * --since re-reviews everything judged in a window, not just outright failures.
 * Needed because reviews made before the description-truncation fix saw only
 * company boilerplate, so their verdicts - including AUTO_DISMISS - are unsound.
 * --include-dismissed pulls back jobs already moved to NOT_FIT by such a review.
 *
 * Only recent jobs are re-reviewed by default: older listings are usually dead,
 * and re-reviewing them spends API credit for no benefit.
 */

import { config } from 'dotenv';
import { db, getProfile, updateJobStatus, updateJobWithAIReview } from './storage/db.js';
import { reviewCandidates } from './ai/reviewCandidates.js';
import type { Job } from './types.js';

config({ quiet: true });

const FAILED_MARKER = 'Review failed, needs manual evaluation';

interface Args {
  dryRun: boolean;
  confirm: boolean;
  limit: number;
  maxAgeDays: number;
  since?: string;
  includeDismissed: boolean;
}

function parseArgs(): Args {
  const args: Args = { dryRun: false, confirm: false, limit: 100, maxAgeDays: 30, includeDismissed: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run') args.dryRun = true;
    if (arg === '--confirm') args.confirm = true;
    if (arg.startsWith('--limit=')) args.limit = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--max-age-days=')) args.maxAgeDays = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--since=')) args.since = arg.split('=')[1];
    if (arg === '--include-dismissed') args.includeDismissed = true;
  }
  return args;
}

function cutoffFor(maxAgeDays: number): string {
  return new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
}

function getJobsToReview(args: Args): Job[] {
  const statuses = args.includeDismissed
    ? "('NEW', 'PENDING', 'NOT_FIT')"
    : "('NEW', 'PENDING')";

  // --since: everything reviewed in the window, regardless of verdict.
  // default: only reviews that outright failed.
  const where = args.since
    ? `date_found >= '${args.since}' AND ai_reviewed = 1`
    : `ai_reasoning = '${FAILED_MARKER}' AND date_found > '${cutoffFor(args.maxAgeDays)}'`;

  const rows = db.prepare(`
    SELECT id, date_found, source, company, title, location, url, description, status, score
    FROM jobs
    WHERE ${where}
      AND status IN ${statuses}
    ORDER BY score DESC, date_found DESC
    LIMIT ?
  `).all(args.limit) as Array<Record<string, unknown>>;

  return rows.map(r => ({
    id: r.id as string,
    dateFound: r.date_found as string,
    source: r.source as Job['source'],
    company: r.company as string,
    title: r.title as string,
    location: r.location as string,
    url: r.url as string,
    description: (r.description as string) || '',
    coverLetter: '',
    status: r.status as Job['status'],
    score: (r.score as number) || 0,
  }));
}

async function main() {
  const args = parseArgs();

  if (!args.dryRun && !args.confirm) {
    console.error('Error: specify --dry-run or --confirm');
    process.exit(1);
  }

  const jobs = getJobsToReview(args);

  if (args.since) {
    console.log(`\nRe-reviewing jobs found since ${args.since}` +
      (args.includeDismissed ? ' (including auto-dismissed)' : ''));
  } else {
    const total = db.prepare(
      `SELECT COUNT(*) c FROM jobs WHERE ai_reasoning = ? AND status IN ('NEW','PENDING')`
    ).get(FAILED_MARKER) as { c: number };
    console.log(`\nJobs with a failed AI review: ${total.c} total`);
  }
  console.log(`Re-reviewing up to ${args.limit} -> ${jobs.length} selected\n`);

  if (jobs.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  if (args.dryRun) {
    for (const j of jobs.slice(0, 20)) {
      console.log(`  [${String(j.score).padStart(3)}] ${j.company} - ${j.title}`);
    }
    if (jobs.length > 20) console.log(`  ... and ${jobs.length - 20} more`);
    console.log('\nDRY RUN: no changes made. Re-run with --confirm.\n');
    return;
  }

  const profile = getProfile();
  if (!profile) {
    console.error('No profile configured - cannot review. Set one up in Settings.');
    process.exit(1);
  }

  const before = new Map(jobs.map(j => [j.id, j.status]));
  const results = await reviewCandidates(jobs, profile);

  let autoDismissed = 0;
  let restored = 0;
  for (const result of results) {
    if (result.suggestion === 'AUTO_DISMISS') {
      updateJobStatus(result.jobId, 'NOT_FIT', 'ai');
      autoDismissed++;
    } else if (before.get(result.jobId) === 'NOT_FIT') {
      // Previously dismissed on a boilerplate-only read; the fresh verdict
      // disagrees, so put it back in front of the user.
      updateJobStatus(result.jobId, 'PENDING', 'ai');
      restored++;
    }
    updateJobWithAIReview(result);
  }
  if (restored > 0) {
    console.log(`Restored ${restored} previously auto-dismissed jobs to PENDING.`);
  }

  const stillFailed = results.filter(r => r.reasoning === FAILED_MARKER).length;

  console.log(`\nApplied ${results.length} reviews (${autoDismissed} auto-dismissed to NOT_FIT).`);
  if (stillFailed > 0) {
    console.log(`WARNING: ${stillFailed} still failed - check API credit/key.`);
  }

}

main().catch(err => { console.error(err); process.exit(1); });
