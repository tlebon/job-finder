import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

let isRunning = false;
let lastRunOutput: string[] = [];

export async function POST() {
  if (isRunning) {
    return NextResponse.json({ error: 'Scraper is already running' }, { status: 409 });
  }

  isRunning = true;
  lastRunOutput = [];

  const scraperDir = path.resolve(process.cwd(), '..');

  const proc = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: scraperDir,
    env: { ...process.env },
    shell: true,
  });

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

  proc.on('close', (code) => {
    isRunning = false;
    console.log(`[Scraper] Process exited with code ${code}`);
  });

  return NextResponse.json({
    started: true,
    message: 'Scraper started in background'
  });
}

export async function GET() {
  return NextResponse.json({
    isRunning,
    recentOutput: lastRunOutput.slice(-20), // Last 20 lines
  });
}
