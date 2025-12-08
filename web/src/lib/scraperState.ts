import { ChildProcess } from 'child_process';

// Singleton state for scraper - shared between API route and cron scheduler
export const scraperState = {
  isRunning: false,
  lastRunOutput: [] as string[],
  currentProcess: null as ChildProcess | null,
  lastRunTime: null as Date | null,
  lastRunStatus: null as 'success' | 'error' | null,
  triggeredBy: null as 'api' | 'cron' | null,
};

export function setScraperRunning(running: boolean, triggeredBy?: 'api' | 'cron') {
  scraperState.isRunning = running;
  if (running && triggeredBy) {
    scraperState.triggeredBy = triggeredBy;
  }
  if (!running) {
    scraperState.currentProcess = null;
  }
}

export function isScraperRunning(): boolean {
  return scraperState.isRunning;
}

export function getScraperState() {
  return {
    isRunning: scraperState.isRunning,
    lastRunTime: scraperState.lastRunTime,
    lastRunStatus: scraperState.lastRunStatus,
    triggeredBy: scraperState.triggeredBy,
    recentOutput: scraperState.lastRunOutput.slice(-20),
  };
}
