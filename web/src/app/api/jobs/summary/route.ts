import { NextRequest, NextResponse } from 'next/server';
import { getJobsSince, getTopJobsSince, Job } from '@/lib/db';

interface SummaryResponse {
  newJobsCount: number;
  newJobsSince: string;
  summary: string;
  strongFitCount: number;
  goodFitCount: number;
  topJobs: Array<{
    id: string;
    title: string;
    company: string;
    location: string;
    aiSuggestion: string;
    aiReasoning: string;
  }>;
}

function generateSummaryText(jobs: Job[], topJobs: Job[]): string {
  if (jobs.length === 0) {
    return "No new jobs found.";
  }

  const strongFits = jobs.filter(j => j.aiSuggestion === 'STRONG_FIT').length;
  const goodFits = jobs.filter(j => j.aiSuggestion === 'GOOD_FIT').length;

  // Group by location
  const locationCounts: Record<string, number> = {};
  for (const job of topJobs) {
    const loc = job.location.toLowerCase();
    if (loc.includes('remote')) {
      locationCounts['Remote'] = (locationCounts['Remote'] || 0) + 1;
    } else if (loc.includes('lisbon') || loc.includes('portugal')) {
      locationCounts['Portugal'] = (locationCounts['Portugal'] || 0) + 1;
    } else if (loc.includes('berlin') || loc.includes('germany')) {
      locationCounts['Germany'] = (locationCounts['Germany'] || 0) + 1;
    } else if (loc.includes('barcelona') || loc.includes('madrid') || loc.includes('spain')) {
      locationCounts['Spain'] = (locationCounts['Spain'] || 0) + 1;
    } else if (loc.includes('amsterdam') || loc.includes('netherlands')) {
      locationCounts['Netherlands'] = (locationCounts['Netherlands'] || 0) + 1;
    } else if (loc.includes('paris') || loc.includes('france')) {
      locationCounts['France'] = (locationCounts['France'] || 0) + 1;
    } else if (loc.includes('london') || loc.includes('uk') || loc.includes('united kingdom')) {
      locationCounts['UK'] = (locationCounts['UK'] || 0) + 1;
    } else {
      locationCounts['Other'] = (locationCounts['Other'] || 0) + 1;
    }
  }

  // Build summary parts
  const parts: string[] = [];

  // Job count
  parts.push(`${jobs.length} new job${jobs.length === 1 ? '' : 's'} found`);

  // Match quality
  if (strongFits > 0 || goodFits > 0) {
    const matchParts: string[] = [];
    if (strongFits > 0) matchParts.push(`${strongFits} strong fit${strongFits === 1 ? '' : 's'}`);
    if (goodFits > 0) matchParts.push(`${goodFits} good fit${goodFits === 1 ? '' : 's'}`);
    parts.push(matchParts.join(', '));
  }

  // Locations
  const locationParts = Object.entries(locationCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([loc, count]) => `${count} in ${loc}`);

  if (locationParts.length > 0) {
    parts.push(locationParts.join(', '));
  }

  // Top companies
  const topCompanies = [...new Set(topJobs.slice(0, 3).map(j => j.company))];
  if (topCompanies.length > 0) {
    parts.push(`including ${topCompanies.join(', ')}`);
  }

  return parts.join(' — ');
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const since = searchParams.get('since');

  if (!since) {
    return NextResponse.json({
      error: 'Missing "since" query parameter (ISO date string)',
    }, { status: 400 });
  }

  try {
    // Get all jobs since the date
    const allNewJobs = getJobsSince(since);

    // Get top matches
    const topJobs = getTopJobsSince(since, 5);

    // Count by suggestion type
    const strongFitCount = allNewJobs.filter(j => j.aiSuggestion === 'STRONG_FIT').length;
    const goodFitCount = allNewJobs.filter(j => j.aiSuggestion === 'GOOD_FIT').length;

    // Generate summary
    const summary = generateSummaryText(allNewJobs, topJobs);

    const response: SummaryResponse = {
      newJobsCount: allNewJobs.length,
      newJobsSince: since,
      summary,
      strongFitCount,
      goodFitCount,
      topJobs: topJobs.map(job => ({
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        aiSuggestion: job.aiSuggestion || 'UNKNOWN',
        aiReasoning: job.aiReasoning || '',
      })),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error generating summary:', error);
    return NextResponse.json({
      error: 'Failed to generate summary',
    }, { status: 500 });
  }
}
