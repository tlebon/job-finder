import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * Questions grouped by the application they belong to.
 *
 * A flat list of 43 questions is the wrong shape: nobody answers "question 7 of
 * 43". You sit down with one company's form and work through it, so the unit is
 * the application.
 *
 * The slug is the company, lowercased - stable, readable, and enough to
 * distinguish the handful of applications open at once.
 */

const slugify = (s: string) =>
  (s || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

interface Row {
  company: string | null; job_id: string | null; ats: string | null;
  total: number; answered: number; last_touched: string | null;
}

export async function GET() {
  const rows = db.prepare(`
    SELECT company, job_id, ats,
           COUNT(*) total,
           SUM(answer IS NOT NULL AND answer <> '') answered,
           MAX(COALESCE(last_confirmed, created_at)) last_touched
    FROM application_questions
    WHERE kind <> 'mechanical'
    GROUP BY COALESCE(company, 'unknown')
    ORDER BY (SUM(answer IS NOT NULL AND answer <> '') < COUNT(*)) DESC, last_touched DESC
  `).all() as Row[];

  return NextResponse.json({
    applications: rows.map(r => ({
      slug: slugify(r.company ?? 'unknown'),
      company: r.company ?? 'Unfiled',
      jobId: r.job_id ?? undefined,
      ats: r.ats ?? undefined,
      total: r.total,
      answered: r.answered ?? 0,
      lastTouched: r.last_touched ?? undefined,
    })),
  });
}
