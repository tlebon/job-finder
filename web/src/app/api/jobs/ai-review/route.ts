import { NextResponse } from 'next/server';
import { getJobsByStatus, getProfile } from '@/lib/db';
import { db } from '@/lib/db';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

type AISuggestion = 'STRONG_FIT' | 'GOOD_FIT' | 'MAYBE' | 'AUTO_DISMISS';

interface ReviewResult {
  jobId: string;
  suggestion: AISuggestion;
  reasoning: string;
  scoreAdjustment: number;
}

const AI_SUGGESTION_ORDER: Record<AISuggestion, number> = {
  STRONG_FIT: 0,
  GOOD_FIT: 1,
  MAYBE: 2,
  AUTO_DISMISS: 3,
};

const BATCH_SIZE = 5;

async function reviewBatch(jobs: { id: string; title: string; company: string; location: string; description: string }[], profile: NonNullable<ReturnType<typeof getProfile>>): Promise<ReviewResult[]> {
  const jobDescriptions = jobs.map((job, i) => `
JOB ${i + 1} (ID: ${job.id}):
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location}
- Description: ${job.description?.substring(0, 1500) || 'No description'}
`).join('\n---\n');

  const prompt = `You are helping a job seeker review job listings to determine which ones are worth applying to.

CANDIDATE PROFILE:
- Name: ${profile.name}
- Current Title: ${profile.title}
- Location: ${profile.location}
- Skills: ${profile.skills}
- Experience: ${profile.experience?.substring(0, 1000) || 'Not provided'}
- Preferences: ${profile.preferences || 'No specific preferences noted'}

JOBS TO REVIEW:
${jobDescriptions}

For EACH job, evaluate:
1. Does the role match the candidate's skills and experience level?
2. Is the location compatible (remote, or candidate's location, or they mentioned being open to relocation)?
3. Is the seniority appropriate (not too junior, not requiring 15+ years)?
4. Are there any red flags (obvious mismatch, spam posting, requires skills they don't have)?

Categorize each job as:
- STRONG_FIT: Excellent match for skills and preferences, should definitely apply
- GOOD_FIT: Solid match, worth applying
- MAYBE: Some fit but uncertain, candidate should review manually
- AUTO_DISMISS: Obvious mismatch (wrong field, wrong seniority, location incompatible, etc.)

OUTPUT FORMAT (JSON array, one object per job, in order):
[
  {
    "jobId": "the job ID",
    "suggestion": "STRONG_FIT|GOOD_FIT|MAYBE|AUTO_DISMISS",
    "reasoning": "1-2 sentence explanation",
    "scoreAdjustment": number (-50 to +50)
  }
]

Score adjustments:
- STRONG_FIT: +30 to +50
- GOOD_FIT: +10 to +25
- MAYBE: -10 to +10
- AUTO_DISMISS: -50

Be conservative with AUTO_DISMISS - only use it for obvious mismatches. When in doubt, use MAYBE.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = message.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return jobs.map(job => ({
        jobId: job.id,
        suggestion: 'MAYBE' as AISuggestion,
        reasoning: 'Could not evaluate',
        scoreAdjustment: 0,
      }));
    }

    let jsonText = textBlock.text.trim();
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    }

    const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    const results = JSON.parse(jsonText) as ReviewResult[];

    return results.map((result, i) => ({
      jobId: result.jobId || jobs[i]?.id || '',
      suggestion: (['STRONG_FIT', 'GOOD_FIT', 'MAYBE', 'AUTO_DISMISS'].includes(result.suggestion)
        ? result.suggestion
        : 'MAYBE') as AISuggestion,
      reasoning: result.reasoning || 'No reasoning provided',
      scoreAdjustment: typeof result.scoreAdjustment === 'number'
        ? Math.max(-50, Math.min(50, result.scoreAdjustment))
        : 0,
    }));
  } catch (error) {
    console.error('Batch review error:', error);
    return jobs.map(job => ({
      jobId: job.id,
      suggestion: 'MAYBE' as AISuggestion,
      reasoning: 'Review failed, needs manual evaluation',
      scoreAdjustment: 0,
    }));
  }
}

// In-memory state for tracking review progress
let reviewState = {
  isRunning: false,
  total: 0,
  completed: 0,
  currentJob: '',
  summary: null as { strongFit: number; goodFit: number; maybe: number; autoDismiss: number } | null,
};

export async function GET() {
  return NextResponse.json(reviewState);
}

export async function POST() {
  if (reviewState.isRunning) {
    return NextResponse.json({ error: 'Review already in progress' }, { status: 400 });
  }

  const profile = getProfile();
  if (!profile) {
    return NextResponse.json({ error: 'No profile configured. Set up your profile in Settings first.' }, { status: 400 });
  }

  // Get pending jobs that haven't been AI reviewed yet
  const allPendingJobs = getJobsByStatus('PENDING');
  const pendingJobs = allPendingJobs.filter(job => !job.aiReviewed);

  if (pendingJobs.length === 0) {
    return NextResponse.json({ message: 'No unreviewed jobs to process', alreadyReviewed: allPendingJobs.length });
  }

  // Start async review process
  reviewState = {
    isRunning: true,
    total: pendingJobs.length,
    completed: 0,
    currentJob: '',
    summary: null,
  };

  // Track summary counts
  const summaryCounts = { strongFit: 0, goodFit: 0, maybe: 0, autoDismiss: 0 };

  // Run in background
  (async () => {
    try {
      for (let i = 0; i < pendingJobs.length; i += BATCH_SIZE) {
        const batch = pendingJobs.slice(i, i + BATCH_SIZE);
        reviewState.currentJob = `${batch[0]?.company} - ${batch[0]?.title}`;

        const results = await reviewBatch(batch, profile);

        // Update database with results
        for (const result of results) {
          db.prepare(`
            UPDATE jobs
            SET ai_reviewed = 1,
                ai_suggestion = ?,
                ai_reasoning = ?,
                score = score + ?
            WHERE id = ?
          `).run(result.suggestion, result.reasoning, result.scoreAdjustment, result.jobId);

          // Track counts for summary
          if (result.suggestion === 'STRONG_FIT') summaryCounts.strongFit++;
          else if (result.suggestion === 'GOOD_FIT') summaryCounts.goodFit++;
          else if (result.suggestion === 'MAYBE') summaryCounts.maybe++;
          else if (result.suggestion === 'AUTO_DISMISS') {
            summaryCounts.autoDismiss++;
            db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run('NOT_FIT', result.jobId);
          }
        }

        reviewState.completed += batch.length;

        // Small delay between batches
        if (i + BATCH_SIZE < pendingJobs.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    } catch (error) {
      console.error('AI review error:', error);
    } finally {
      reviewState.isRunning = false;
      reviewState.currentJob = '';
      reviewState.summary = summaryCounts;
    }
  })();

  return NextResponse.json({
    message: 'AI review started',
    total: pendingJobs.length,
  });
}
