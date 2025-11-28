import { NextResponse } from 'next/server';
import { getJobById, updateJobWithLetter } from '@/lib/db';
import { generateCoverLetter } from '@/lib/coverLetter';

// In-memory store for generation status per job
const generationStatus = new Map<string, {
  status: 'pending' | 'generating' | 'done' | 'error';
  result?: { draft: string; feedback: string; final: string };
  error?: string;
  startedAt: number;
}>();

// Clean up old entries after 10 minutes
function cleanupOldEntries() {
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  for (const [id, data] of generationStatus.entries()) {
    if (data.startedAt < tenMinutesAgo) {
      generationStatus.delete(id);
    }
  }
}

// POST: Start generation in background
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Check if already generating
  const existing = generationStatus.get(id);
  if (existing && existing.status === 'generating') {
    return NextResponse.json({
      status: 'generating',
      message: 'Generation already in progress'
    });
  }

  const job = getJobById(id);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // Set status to generating
  generationStatus.set(id, {
    status: 'generating',
    startedAt: Date.now(),
  });

  // Run generation in background (don't await)
  (async () => {
    try {
      const result = await generateCoverLetter(job);

      // Auto-save the result and update status to NEW (ready)
      updateJobWithLetter(id, result.final, 'NEW');

      generationStatus.set(id, {
        status: 'done',
        result,
        startedAt: Date.now(),
      });
    } catch (error) {
      console.error('Error generating cover letter:', error);
      generationStatus.set(id, {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        startedAt: Date.now(),
      });
    }
  })();

  // Clean up old entries periodically
  cleanupOldEntries();

  return NextResponse.json({
    status: 'generating',
    message: 'Generation started'
  });
}

// GET: Check generation status
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const status = generationStatus.get(id);

  if (!status) {
    return NextResponse.json({ status: 'idle' });
  }

  if (status.status === 'done') {
    // Clear the status after returning (one-time read)
    const result = status.result;
    generationStatus.delete(id);
    return NextResponse.json({
      status: 'done',
      result,
    });
  }

  if (status.status === 'error') {
    const error = status.error;
    generationStatus.delete(id);
    return NextResponse.json({
      status: 'error',
      error,
    });
  }

  return NextResponse.json({ status: status.status });
}
