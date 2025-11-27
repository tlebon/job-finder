import { NextRequest, NextResponse } from 'next/server';
import { getJobById, updateJobWithLetter, getPendingQueue, addToQueue, updateQueueStatus, clearCompletedQueue, getJobQueue } from '@/lib/db';
import { generateCoverLetter } from '@/lib/coverLetter';

// In-memory state for UI progress (supplements database queue)
interface BatchState {
  isRunning: boolean;
  currentJob: string;
  logs: string[];
}

const state: BatchState = {
  isRunning: false,
  currentJob: '',
  logs: [],
};

// Background job runner
async function runBatchGeneration() {
  if (state.isRunning) return;

  state.isRunning = true;
  state.logs = [];

  const pending = getPendingQueue();
  if (pending.length === 0) {
    state.isRunning = false;
    return;
  }

  state.logs.push(`Processing ${pending.length} queued jobs...`);

  for (const queueItem of pending) {
    // Mark as processing
    updateQueueStatus(queueItem.id, 'processing');

    const job = getJobById(queueItem.jobId);
    if (!job) {
      state.logs.push(`Job ${queueItem.jobId} not found`);
      updateQueueStatus(queueItem.id, 'failed', 'Job not found');
      continue;
    }

    state.currentJob = `${job.title} @ ${job.company}`;
    state.logs.push(`Generating letter for: ${state.currentJob}`);

    try {
      const result = await generateCoverLetter(job);
      updateJobWithLetter(queueItem.jobId, result.final, 'NEW');
      updateQueueStatus(queueItem.id, 'done');
      state.logs.push(`✓ Completed: ${job.title}`);
    } catch (err) {
      console.error(`Failed to generate letter for ${job.title}:`, err);
      updateQueueStatus(queueItem.id, 'failed', String(err));
      state.logs.push(`✗ Failed: ${job.title} - ${String(err)}`);
    }

    // Rate limit between jobs
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  state.isRunning = false;
  state.currentJob = '';
  state.logs.push(`Batch complete`);
}

// GET - Check status
export async function GET() {
  const queue = getJobQueue();
  const pending = queue.filter(q => q.status === 'pending' || q.status === 'processing');
  const completed = queue.filter(q => q.status === 'done');
  const failed = queue.filter(q => q.status === 'failed');

  return NextResponse.json({
    isRunning: state.isRunning,
    pending: pending.length,
    completed: completed.length,
    failed: failed.length,
    total: queue.length,
    currentJob: state.currentJob,
    recentLogs: state.logs.slice(-10),
    queue: pending.slice(0, 5), // Show first 5 pending
  });
}

// POST - Start batch generation (add to queue)
export async function POST(request: NextRequest) {
  try {
    const { jobIds, resume } = await request.json();

    // If resume flag, just restart processing existing queue
    if (resume) {
      runBatchGeneration();
      const pending = getPendingQueue();
      return NextResponse.json({
        message: 'Resuming batch generation',
        pending: pending.length,
      });
    }

    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return NextResponse.json(
        { error: 'No job IDs provided' },
        { status: 400 }
      );
    }

    // Add jobs to persistent queue
    addToQueue(jobIds);

    // Start background job (don't await)
    runBatchGeneration();

    return NextResponse.json({
      message: 'Jobs added to queue',
      added: jobIds.length,
    });
  } catch (err) {
    console.error('Failed to start batch generation:', err);
    return NextResponse.json(
      { error: 'Failed to start batch generation' },
      { status: 500 }
    );
  }
}

// DELETE - Clear completed/failed from queue
export async function DELETE() {
  const cleared = clearCompletedQueue();
  return NextResponse.json({
    message: 'Queue cleared',
    removed: cleared,
  });
}
