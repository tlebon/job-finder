import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { spawn } from 'child_process';
import path from 'path';

/**
 * GET /api/jobs/cleanup
 * Returns cleanup statistics
 */
export async function GET() {
  try {
    // Count jobs by status
    const deadCount = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?').get('DEAD') as { count: number };
    const expiredCount = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?').get('EXPIRED') as { count: number };

    // Count candidates for checking (jobs with old or no last_url_check)
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const candidatesForCheck = db.prepare(`
      SELECT COUNT(*) as count FROM jobs
      WHERE status NOT IN ('DEAD', 'EXPIRED', 'NOT_FIT')
        AND (last_url_check IS NULL OR last_url_check < ?)
    `).get(oneWeekAgo) as { count: number };

    // Count jobs with failures
    const failingJobs = db.prepare(`
      SELECT COUNT(*) as count FROM jobs
      WHERE check_failures > 0
        AND status NOT IN ('DEAD', 'EXPIRED')
    `).get() as { count: number };

    return NextResponse.json({
      dead: deadCount.count,
      expired: expiredCount.count,
      candidatesForCheck: candidatesForCheck.count,
      failingJobs: failingJobs.count,
    });
  } catch (error) {
    console.error('Failed to get cleanup stats:', error);
    return NextResponse.json(
      { error: 'Failed to get cleanup statistics' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/jobs/cleanup
 * Triggers manual cleanup
 * Body: { dryRun?: boolean, batchSize?: number }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const dryRun = body.dryRun ?? true; // Default to dry run for safety
    const batchSize = body.batchSize ?? 50;

    // Spawn cleanup script
    const scriptPath = path.join(process.cwd(), '..', 'src', 'cleanup-deadlinks.ts');
    const args = [
      scriptPath,
      dryRun ? '--dry-run' : '--confirm',
      `--batch-size=${batchSize}`,
    ];

    return new Promise((resolve) => {
      const child = spawn('npx', ['tsx', ...args], {
        cwd: path.join(process.cwd(), '..'),
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          // Parse results from stdout
          const checkedMatch = stdout.match(/Checked:\s+(\d+)/);
          const deadMatch = stdout.match(/Dead:\s+(\d+)/);
          const expiredMatch = stdout.match(/Expired:\s+(\d+)/);
          const errorsMatch = stdout.match(/Errors:\s+(\d+)/);

          resolve(
            NextResponse.json({
              success: true,
              dryRun,
              checked: checkedMatch ? parseInt(checkedMatch[1]) : 0,
              marked: {
                dead: deadMatch ? parseInt(deadMatch[1]) : 0,
                expired: expiredMatch ? parseInt(expiredMatch[1]) : 0,
              },
              errors: errorsMatch ? parseInt(errorsMatch[1]) : 0,
              output: stdout,
            })
          );
        } else {
          resolve(
            NextResponse.json(
              { error: 'Cleanup script failed', stderr, stdout },
              { status: 500 }
            )
          );
        }
      });
    });
  } catch (error) {
    console.error('Failed to trigger cleanup:', error);
    return NextResponse.json(
      { error: 'Failed to trigger cleanup' },
      { status: 500 }
    );
  }
}
