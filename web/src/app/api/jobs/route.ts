import { NextRequest, NextResponse } from 'next/server';
import { getJobs, getJobsByStatus, getJobByUrl, insertJob, type Job } from '@/lib/db';

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, company, title, location, description, source = 'manual', status = 'PENDING' } = body;

    // Validate required fields
    if (!url || !company || !title) {
      return NextResponse.json(
        { error: 'Missing required fields: url, company, and title are required' },
        { status: 400 }
      );
    }

    // Check for duplicate URL
    const existingJob = getJobByUrl(url);
    if (existingJob) {
      return NextResponse.json(
        { error: 'A job with this URL already exists', existingJob },
        { status: 409 }
      );
    }

    // Create the job
    const job: Job = {
      id: crypto.randomUUID(),
      dateFound: new Date().toISOString(),
      source,
      company,
      title,
      location: location || 'Not specified',
      url,
      description: description || '',
      coverLetter: '',
      status,
      score: 0,
    };

    insertJob(job);

    return NextResponse.json({ job, message: 'Job added successfully' }, { status: 201 });
  } catch (error) {
    console.error('Error creating job:', error);
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
  }
}
