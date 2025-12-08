import cron, { ScheduledTask } from 'node-cron';
import { spawn } from 'child_process';
import path from 'path';
import { scraperState, setScraperRunning } from './scraperState';

let scheduledTask: ScheduledTask | null = null;

// Default: every 4 hours at minute 0
const DEFAULT_CRON_SCHEDULE = '0 */4 * * *';

function getSchedule(): string {
  return process.env.SCRAPER_CRON_SCHEDULE || DEFAULT_CRON_SCHEDULE;
}

function runScraper(): Promise<void> {
  return new Promise((resolve) => {
    if (scraperState.isRunning) {
      console.log('[Cron] Scraper already running, skipping scheduled run');
      resolve();
      return;
    }

    setScraperRunning(true, 'cron');
    scraperState.lastRunOutput = [];
    scraperState.lastRunTime = new Date();

    const scraperDir = path.resolve(process.cwd(), '..');
    console.log(`[Cron] Starting scraper in directory: ${scraperDir}`);

    const proc = spawn('npx', ['tsx', 'src/index.ts'], {
      cwd: scraperDir,
      env: { ...process.env },
      shell: true,
    });

    scraperState.currentProcess = proc;

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      scraperState.lastRunOutput.push(...lines);
      console.log('[Cron Scraper]', data.toString());
    });

    proc.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      scraperState.lastRunOutput.push(...lines);
      console.error('[Cron Scraper Error]', data.toString());
    });

    proc.on('error', (err) => {
      console.error('[Cron] Failed to start scraper:', err);
      scraperState.lastRunOutput.push(`Failed to start: ${err.message}`);
      scraperState.lastRunStatus = 'error';
      setScraperRunning(false);
      resolve();
    });

    proc.on('close', (code) => {
      setScraperRunning(false);
      scraperState.lastRunStatus = code === 0 ? 'success' : 'error';
      console.log(`[Cron] Scraper process exited with code ${code}`);
      scraperState.lastRunOutput.push(`Process exited with code ${code}`);
      resolve();
    });
  });
}

export function initCronScheduler(): void {
  // Only run in production or if explicitly enabled
  if (process.env.NODE_ENV !== 'production' && !process.env.ENABLE_CRON_DEV) {
    console.log('[Cron] Skipping scheduler init in development (set ENABLE_CRON_DEV=true to enable)');
    return;
  }

  const schedule = getSchedule();

  // Validate cron expression
  if (!cron.validate(schedule)) {
    console.error(`[Cron] Invalid cron schedule: ${schedule}`);
    return;
  }

  console.log(`[Cron] Initializing scheduler with schedule: ${schedule}`);

  scheduledTask = cron.schedule(schedule, async () => {
    console.log(`[Cron] Scheduled job triggered at ${new Date().toISOString()}`);
    try {
      await runScraper();
    } catch (error) {
      console.error('[Cron] Scheduled scraper run failed:', error);
    }
  }, {
    timezone: process.env.TZ || 'UTC',
  });

  console.log('[Cron] Scheduler initialized successfully');
}

export function stopCronScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[Cron] Scheduler stopped');
  }
}
