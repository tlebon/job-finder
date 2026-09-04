#!/usr/bin/env tsx
/**
 * Dead Link Cleanup Script
 *
 * Checks job URLs for validity and marks dead/expired jobs.
 *
 * Detection strategies:
 * - HTTP 404 errors → DEAD
 * - Connection timeouts/failures → DEAD (after 3 consecutive failures)
 * - Redirects to different domain/homepage → DEAD
 * - Page content indicates "job removed" → EXPIRED
 *
 * Usage:
 *   npx tsx src/cleanup-deadlinks.ts --dry-run           # Preview changes
 *   npx tsx src/cleanup-deadlinks.ts --confirm           # Execute changes
 *   npx tsx src/cleanup-deadlinks.ts --batch-size=50     # Process N jobs
 *   npx tsx src/cleanup-deadlinks.ts --status=NEW,PENDING # Check specific statuses
 */

import { config } from 'dotenv';
import { db } from './storage/db.js';
import Anthropic from '@anthropic-ai/sdk';

config({ quiet: true });

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

interface Args {
  dryRun: boolean;
  confirm: boolean;
  batchSize: number;
  statusFilter: string[];
}

function parseArgs(): Args {
  const args: Args = {
    dryRun: false,
    confirm: false,
    batchSize: 50,
    statusFilter: ['NEW', 'PENDING', 'APPLIED', 'INTERVIEW'],
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run') args.dryRun = true;
    if (arg === '--confirm') args.confirm = true;
    if (arg.startsWith('--batch-size=')) {
      args.batchSize = parseInt(arg.split('=')[1], 10);
    }
    if (arg.startsWith('--status=')) {
      args.statusFilter = arg.split('=')[1].split(',');
    }
  }

  return args;
}

interface JobRecord {
  id: string;
  url: string;
  company: string;
  title: string;
  status: string;
  check_failures: number;
}

interface CheckResult {
  jobId: string;
  url: string;
  company: string;
  title: string;
  isValid: boolean;
  reason: string;
  suggestedStatus: 'DEAD' | 'EXPIRED' | null;
}

async function fetchUrlWithTimeout(url: string, timeoutMs: number = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return '';
  }
}

function isHomepageRedirect(originalUrl: string, finalUrl: string): boolean {
  const originalDomain = extractDomain(originalUrl);
  const finalDomain = extractDomain(finalUrl);

  // Different domain = likely removed
  if (originalDomain !== finalDomain) return true;

  // Redirected to homepage paths
  const finalPath = new URL(finalUrl).pathname;
  const homepagePaths = ['/', '/jobs', '/careers', '/jobs/', '/careers/'];

  return homepagePaths.includes(finalPath);
}

async function analyzePageContent(html: string, url: string): Promise<{ isRemoved: boolean; reason: string }> {
  // Fast text-based check first
  const removedKeywords = [
    'job is no longer available',
    'position has been filled',
    'job posting expired',
    'no longer accepting applications',
    'this job has been removed',
    'listing is no longer active',
    'position is closed',
    'application period has ended',
  ];

  const lowerHtml = html.toLowerCase();
  for (const keyword of removedKeywords) {
    if (lowerHtml.includes(keyword)) {
      return { isRemoved: true, reason: `Found keyword: "${keyword}"` };
    }
  }

  // Use Claude for deeper analysis (only if no obvious keywords)
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `Does this job page indicate the position is no longer available? Answer with just YES or NO.\n\nPage excerpt: ${html.substring(0, 2000)}`,
      }],
    });

    const response = message.content[0].type === 'text' ? message.content[0].text.trim() : '';

    if (response.toUpperCase().includes('YES')) {
      return { isRemoved: true, reason: 'AI detected job removed message' };
    }
  } catch (error) {
    console.warn(`AI analysis failed for ${url}:`, error);
  }

  return { isRemoved: false, reason: 'Job appears active' };
}

async function checkJobUrl(job: JobRecord): Promise<CheckResult> {
  const result: CheckResult = {
    jobId: job.id,
    url: job.url,
    company: job.company,
    title: job.title,
    isValid: true,
    reason: 'Job URL is valid',
    suggestedStatus: null,
  };

  try {
    const response = await fetchUrlWithTimeout(job.url);

    // Check for 404
    if (response.status === 404) {
      result.isValid = false;
      result.reason = 'HTTP 404 Not Found';
      result.suggestedStatus = 'DEAD';
      return result;
    }

    // Check for server errors
    if (response.status >= 500) {
      result.isValid = false;
      result.reason = `HTTP ${response.status} Server Error`;
      result.suggestedStatus = 'DEAD';
      return result;
    }

    // Check for homepage redirect
    if (isHomepageRedirect(job.url, response.url)) {
      result.isValid = false;
      result.reason = `Redirected to homepage: ${response.url}`;
      result.suggestedStatus = 'DEAD';
      return result;
    }

    // Analyze page content for "removed" messages
    const html = await response.text();
    const contentCheck = await analyzePageContent(html, job.url);

    if (contentCheck.isRemoved) {
      result.isValid = false;
      result.reason = contentCheck.reason;
      result.suggestedStatus = 'EXPIRED';
      return result;
    }

  } catch (error: unknown) {
    const err = error as Error;
    result.isValid = false;

    if (err.name === 'AbortError') {
      result.reason = 'Request timeout (10s)';
    } else if (err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED')) {
      result.reason = `Connection error: ${err.message}`;
    } else {
      result.reason = `Fetch error: ${err.message}`;
    }

    // Mark as DEAD after 3 consecutive failures
    if (job.check_failures >= 2) {
      result.suggestedStatus = 'DEAD';
      result.reason += ' (3 consecutive failures)';
    }
  }

  return result;
}

async function main() {
  const args = parseArgs();

  if (!args.dryRun && !args.confirm) {
    console.error('Error: Must specify --dry-run or --confirm');
    console.log('\nUsage:');
    console.log('  npx tsx src/cleanup-deadlinks.ts --dry-run           # Preview changes');
    console.log('  npx tsx src/cleanup-deadlinks.ts --confirm           # Execute changes');
    console.log('  npx tsx src/cleanup-deadlinks.ts --batch-size=50     # Process N jobs');
    console.log('  npx tsx src/cleanup-deadlinks.ts --status=NEW,APPLIED # Check specific statuses');
    process.exit(1);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('Dead Link Cleanup Script');
  console.log(`Mode: ${args.dryRun ? 'DRY RUN (no changes)' : 'CONFIRM (will update database)'}`);
  console.log(`Batch size: ${args.batchSize}`);
  console.log(`Status filter: ${args.statusFilter.join(', ')}`);
  console.log(`${'='.repeat(60)}\n`);

  // Get jobs to check (exclude already dead/expired)
  const statusPlaceholders = args.statusFilter.map(() => '?').join(',');
  const jobs = db.prepare(`
    SELECT id, url, company, title, status, check_failures
    FROM jobs
    WHERE status IN (${statusPlaceholders})
      AND status NOT IN ('DEAD', 'EXPIRED')
    ORDER BY last_url_check ASC, date_found DESC
    LIMIT ?
  `).all(...args.statusFilter, args.batchSize) as JobRecord[];

  console.log(`Found ${jobs.length} jobs to check\n`);

  if (jobs.length === 0) {
    console.log('No jobs to check. Exiting.');
    return;
  }

  const results: CheckResult[] = [];
  let checked = 0;
  let dead = 0;
  let expired = 0;
  let errors = 0;

  // Check each job
  for (const job of jobs) {
    checked++;
    process.stdout.write(`\r[${checked}/${jobs.length}] Checking: ${job.company} - ${job.title.substring(0, 40)}...`);

    try {
      const result = await checkJobUrl(job);
      results.push(result);

      if (result.suggestedStatus === 'DEAD') dead++;
      if (result.suggestedStatus === 'EXPIRED') expired++;

      // Update database
      if (!args.dryRun) {
        const now = new Date().toISOString();
        const newFailures = result.isValid ? 0 : job.check_failures + 1;

        if (result.suggestedStatus) {
          // Mark as DEAD or EXPIRED
          db.prepare(`
            UPDATE jobs
            SET status = ?,
                last_url_check = ?,
                check_failures = ?,
                updated_at = ?
            WHERE id = ?
          `).run(result.suggestedStatus, now, newFailures, now, job.id);
        } else {
          // Just update check timestamp
          db.prepare(`
            UPDATE jobs
            SET last_url_check = ?,
                check_failures = ?,
                updated_at = ?
            WHERE id = ?
          `).run(now, newFailures, now, job.id);
        }
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      errors++;
      console.error(`\nError checking job ${job.id}:`, error);
    }
  }

  console.log(`\n\n${'='.repeat(60)}`);
  console.log('Cleanup Summary');
  console.log(`${'='.repeat(60)}`);
  console.log(`Checked:  ${checked} jobs`);
  console.log(`Dead:     ${dead} jobs (404, timeout, redirect)`);
  console.log(`Expired:  ${expired} jobs ("job removed" message)`);
  console.log(`Errors:   ${errors} jobs`);
  console.log(`Valid:    ${checked - dead - expired - errors} jobs`);
  console.log(`${'='.repeat(60)}\n`);

  // Show affected jobs
  if (dead > 0 || expired > 0) {
    console.log('Affected Jobs:\n');
    for (const result of results) {
      if (result.suggestedStatus) {
        console.log(`[${result.suggestedStatus}] ${result.company} - ${result.title}`);
        console.log(`  URL: ${result.url}`);
        console.log(`  Reason: ${result.reason}\n`);
      }
    }
  }

  if (args.dryRun) {
    console.log('DRY RUN: No changes made to database.');
    console.log('Run with --confirm to apply changes.\n');
  } else {
    console.log('Changes applied to database.\n');
  }
}

main().catch(console.error);
