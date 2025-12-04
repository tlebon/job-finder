import { NextResponse } from 'next/server';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

let isRunning = false;
let lastRunOutput: string[] = [];
let currentProcess: ChildProcess | null = null;

export async function POST() {
  if (isRunning) {
    return NextResponse.json({ error: 'Scraper is already running' }, { status: 409 });
  }

  isRunning = true;
  lastRunOutput = [];

  const scraperDir = path.resolve(process.cwd(), '..');

  console.log(`[Scraper] Starting in directory: ${scraperDir}`);

  const proc = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: scraperDir,
    env: { ...process.env },
    shell: true,
  });

  currentProcess = proc;

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lastRunOutput.push(...lines);
    console.log('[Scraper]', data.toString());
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lastRunOutput.push(...lines);
    console.error('[Scraper Error]', data.toString());
  });

  proc.on('error', (err) => {
    console.error('[Scraper] Failed to start:', err);
    lastRunOutput.push(`Failed to start: ${err.message}`);
    isRunning = false;
    currentProcess = null;
  });

  proc.on('close', (code) => {
    isRunning = false;
    currentProcess = null;
    console.log(`[Scraper] Process exited with code ${code}`);
    lastRunOutput.push(`Process exited with code ${code}`);
  });

  return NextResponse.json({
    started: true,
    message: 'Scraper started in background'
  });
}

export async function DELETE() {
  if (!isRunning || !currentProcess) {
    return NextResponse.json({ error: 'No scraper is running' }, { status: 404 });
  }

  try {
    // Kill the process and its children (shell: true spawns a shell)
    currentProcess.kill('SIGTERM');

    // Force kill after 2 seconds if still running
    setTimeout(() => {
      if (currentProcess && !currentProcess.killed) {
        currentProcess.kill('SIGKILL');
      }
    }, 2000);

    lastRunOutput.push('[Cancelled by user]');

    return NextResponse.json({
      cancelled: true,
      message: 'Scraper cancellation requested'
    });
  } catch (error) {
    console.error('Error cancelling scraper:', error);
    return NextResponse.json({ error: 'Failed to cancel scraper' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    isRunning,
    recentOutput: lastRunOutput.slice(-20), // Last 20 lines
  });
}
