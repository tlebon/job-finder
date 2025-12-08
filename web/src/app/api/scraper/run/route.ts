import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { scraperState, setScraperRunning, isScraperRunning, getScraperState } from '@/lib/scraperState';

export async function POST() {
  if (isScraperRunning()) {
    return NextResponse.json({
      error: 'Scraper is already running',
      triggeredBy: scraperState.triggeredBy,
    }, { status: 409 });
  }

  setScraperRunning(true, 'api');
  scraperState.lastRunOutput = [];
  scraperState.lastRunTime = new Date();

  const scraperDir = path.resolve(process.cwd(), '..');

  console.log(`[Scraper] Starting in directory: ${scraperDir}`);

  const proc = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: scraperDir,
    env: { ...process.env },
    shell: true,
  });

  scraperState.currentProcess = proc;

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    scraperState.lastRunOutput.push(...lines);
    console.log('[Scraper]', data.toString());
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    scraperState.lastRunOutput.push(...lines);
    console.error('[Scraper Error]', data.toString());
  });

  proc.on('error', (err) => {
    console.error('[Scraper] Failed to start:', err);
    scraperState.lastRunOutput.push(`Failed to start: ${err.message}`);
    scraperState.lastRunStatus = 'error';
    setScraperRunning(false);
  });

  proc.on('close', (code) => {
    setScraperRunning(false);
    scraperState.lastRunStatus = code === 0 ? 'success' : 'error';
    console.log(`[Scraper] Process exited with code ${code}`);
    scraperState.lastRunOutput.push(`Process exited with code ${code}`);
  });

  return NextResponse.json({
    started: true,
    message: 'Scraper started in background',
    triggeredBy: 'api',
  });
}

export async function DELETE() {
  if (!isScraperRunning() || !scraperState.currentProcess) {
    return NextResponse.json({ error: 'No scraper is running' }, { status: 404 });
  }

  try {
    scraperState.currentProcess.kill('SIGTERM');

    setTimeout(() => {
      if (scraperState.currentProcess && !scraperState.currentProcess.killed) {
        scraperState.currentProcess.kill('SIGKILL');
      }
    }, 2000);

    scraperState.lastRunOutput.push('[Cancelled by user]');

    return NextResponse.json({
      cancelled: true,
      message: 'Scraper cancellation requested',
    });
  } catch (error) {
    console.error('Error cancelling scraper:', error);
    return NextResponse.json({ error: 'Failed to cancel scraper' }, { status: 500 });
  }
}

export async function GET() {
  const scraperDir = path.resolve(process.cwd(), '..');
  const state = getScraperState();

  return NextResponse.json({
    ...state,
    debug: {
      cwd: process.cwd(),
      scraperDir,
    },
  });
}
