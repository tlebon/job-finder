import { NextRequest, NextResponse } from 'next/server';
import { getJobs, getJobsByStatus } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    // Filter by status if provided
    const jobs = status ? getJobsByStatus(status) : getJobs();
    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 });
  }
}
