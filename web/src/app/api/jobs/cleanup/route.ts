import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { spawn } from 'child_process';
import path from 'path';

interface CleanupRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * GET /api/jobs/cleanup
 * Returns cleanup statistics
 */
export async function GET(): Promise<NextResponse> {
  try {
    const deadCount = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?').get('DEAD') as { count: number };
    const expiredCount = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?').get('EXPIRED') as { count: number };
    const archivedCount = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?').get('ARCHIVED') as { count: number };

    // Jobs never checked, or not checked in the last week
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const candidatesForCheck = db.prepare(`
      SELECT COUNT(*) as count FROM jobs
      WHERE status NOT IN ('DEAD', 'EXPIRED', 'ARCHIVED', 'NOT_FIT')
        AND (last_url_check IS NULL OR last_url_check < ?)
    `).get(oneWeekAgo) as { count: number };

    const failingJobs = db.prepare(`
      SELECT COUNT(*) as count FROM jobs
      WHERE check_failures > 0
        AND status NOT IN ('DEAD', 'EXPIRED')
    `).get() as { count: number };

    return NextResponse.json({
      dead: deadCount.count,
      expired: expiredCount.count,
      archived: archivedCount.count,
      candidatesForCheck: candidatesForCheck.count,
      failingJobs: failingJobs.count,
    });
  } catch (error) {
    console.error('Failed to get cleanup stats:', error);
    return NextResponse.json({ error: 'Failed to get cleanup statistics' }, { status: 500 });
  }
}

function runCleanupScript(dryRun: boolean, batchSize: number): Promise<CleanupRun> {
  return new Promise<CleanupRun>((resolve, reject) => {
    const scraperDir = path.resolve(process.cwd(), '..');
    const child = spawn(
      'npx',
      ['tsx', 'src/cleanup-deadlinks.ts', dryRun ? '--dry-run' : '--confirm', `--batch-size=${batchSize}`],
      { cwd: scraperDir, env: { ...process.env } }
    );

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function parseCount(output: string, label: string): number {
  const match = output.match(new RegExp(`${label}:\\s+(\\d+)`));
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * POST /api/jobs/cleanup
 * Triggers a cleanup run. Defaults to a dry run so an accidental call is harmless.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dryRun ?? true;
    const batchSize = body.batchSize ?? 50;

    const { code, stdout, stderr } = await runCleanupScript(dryRun, batchSize);

    if (code !== 0) {
      return NextResponse.json({ error: 'Cleanup script failed', stderr, stdout }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      dryRun,
      checked: parseCount(stdout, 'Checked'),
      marked: {
        dead: parseCount(stdout, 'Dead'),
        expired: parseCount(stdout, 'Expired'),
      },
      errors: parseCount(stdout, 'Errors'),
      output: stdout,
    });
  } catch (error) {
    console.error('Failed to trigger cleanup:', error);
    return NextResponse.json({ error: 'Failed to trigger cleanup' }, { status: 500 });
  }
}
