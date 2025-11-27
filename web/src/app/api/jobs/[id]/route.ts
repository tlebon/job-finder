import { NextResponse } from 'next/server';
import { getJobById, updateJobCoverLetter, updateJobStatus, deleteJob, addToBlocklist } from '@/lib/db';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = getJobById(id);

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (error) {
    console.error('Error fetching job:', error);
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (body.coverLetter !== undefined) {
      updateJobCoverLetter(id, body.coverLetter);
    }

    if (body.status !== undefined) {
      updateJobStatus(id, body.status);

      // Handle NOT_FIT with auto-blocklist
      if (body.status === 'NOT_FIT' && body.notFitReason) {
        const job = getJobById(id);
        if (job) {
          switch (body.notFitReason) {
            case 'company':
              addToBlocklist('company', job.company, `NOT_FIT: ${job.title}`);
              break;
            case 'keyword':
              if (body.blockValue) {
                addToBlocklist('keyword', body.blockValue, `From: ${job.title} @ ${job.company}`);
              }
              break;
            case 'title_pattern':
              if (body.blockValue) {
                addToBlocklist('title_pattern', body.blockValue, `From: ${job.title}`);
              }
              break;
            // 'other' - just mark as NOT_FIT, don't block anything
          }
        }
      }
    }

    const job = getJobById(id);
    return NextResponse.json({ job });
  } catch (error) {
    console.error('Error updating job:', error);
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const success = deleteJob(id);

    if (!success) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting job:', error);
    return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 });
  }
}
