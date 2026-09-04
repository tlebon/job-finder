import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config.js';
import type { Job, Reach } from '../types.js';
import type { AIReviewResult, AISuggestion } from '../storage/db.js';
import { excerptForReview } from '../utils/jobText.js';

const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

export interface Profile {
  name: string;
  title: string;
  location: string;
  skills: string;
  experience: string;
  preferences: string;
}

interface BatchReviewResult {
  jobId: string;
  suggestion: AISuggestion;
  reach?: Reach;
  reasoning: string;
  scoreAdjustment: number;
}

/**
 * Two jobs per call, not five.
 *
 * Measured by src/eval-reviewer-consistency.ts, the reviewer agreed with its own
 * earlier verdict on 50% of 115 re-reviews, and 20% crossed the good/not-good
 * line the pipeline turns on. Of ten jobs first called STRONG_FIT, zero came
 * back STRONG_FIT. Batching five to a prompt is one cause: a verdict is
 * conditioned on the four arbitrary neighbours a job landed with, which is pure
 * noise with respect to the job. Smaller batches cost more calls and are worth
 * it, because every downstream number is measured against these labels and
 * label noise drags all of them toward chance.
 */
const BATCH_SIZE = 2;

async function reviewBatch(jobs: Job[], profile: Profile): Promise<BatchReviewResult[]> {
  const jobDescriptions = jobs.map((job, i) => `
JOB ${i + 1} (ID: ${job.id}):
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location}
- Description: ${excerptForReview(job.description) || 'No description'}
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

The question is whether the candidate would CONSIDER APPLYING - not whether they
are the strongest applicant. Those differ, and for someone mid-career-change they
often point opposite ways.

This candidate is changing direction. A role asking for skills they are actively
building is the target, not a mismatch. Do not penalise a posting for requiring
experience they are in the middle of acquiring, and do not reward a posting
merely for matching what they did three years ago.

What genuinely rules a job out:
- A different profession. Sales, recruiting, marketing, design, legal, customer
  success, account management. Not engineering.
- A hard language requirement they do not meet (fluent or native German as a
  stated requirement; "German a plus" is fine).
- A doctorate or equivalent research record stated as required.
- Purely managerial with no hands-on engineering, when they want an IC role.
- A location they cannot work in, given they will relocate for the right role
  with support.

What does NOT rule a job out:
- Asking for more years than they have. A stretch is their call to make.
- Naming tools they have not used, when the shape of the work fits.
- Being a famous or highly competitive employer. Aiming high is their decision.
- Being outside their previous industry, if the engineering fits.

Answer TWO SEPARATE questions about each job. Do not blend them - collapsing
them is what makes a verdict useless, because a moonshot and a poor match come
out looking identical.

FIRST, how much would they want it?
- STRONG_FIT: They would want to apply. Either it is squarely the work they are
  moving toward, or a strong match at a company that fits their values.
- GOOD_FIT: Worth applying to. Real overlap, some compromise.
- MAYBE: Genuinely unclear.
- AUTO_DISMISS: One of the ruling-out conditions above actually applies. Not
  "they might not get it" - only "they would not want it or could not take it".

SECOND, and independently, how far a reach is it?
- realistic: their background plausibly clears the bar as written.
- stretch: they would be a credible but not obvious candidate. Missing some of
  the stated experience, or a step up in scope.
- moonshot: they would be a long shot. Far more experience asked for than they
  have, a research record they lack, or an extremely competitive employer.

Reach is about the odds, not the appeal. A dream job at a famous lab is
STRONG_FIT and moonshot at the same time, and that combination is useful to
know - it is not a reason to downgrade either answer. Judge reach against the
posting's stated requirements, not against how well known the company is,
except where competition genuinely dominates.

OUTPUT FORMAT (JSON array, one object per job, in order):
[
  {
    "jobId": "the job ID",
    "suggestion": "STRONG_FIT|GOOD_FIT|MAYBE|AUTO_DISMISS",
    "reach": "realistic|stretch|moonshot",
    "reasoning": "1-2 sentence explanation",
    "scoreAdjustment": number (-50 to +50)
  }
]

Score adjustments, from the first question only. Reach must not affect them -
it is recorded separately so the candidate can decide his own appetite for a
long shot, and folding it in here would take that decision away from him.
- STRONG_FIT: +30 to +50
- GOOD_FIT: +10 to +25
- MAYBE: -10 to +10
- AUTO_DISMISS: -50

Be conservative with AUTO_DISMISS. It is for jobs the candidate would not want
or could not take, never for jobs they might not be selected for. When in doubt,
use MAYBE.

Judge each posting on its own. The jobs in this batch are unrelated to one
another and their order carries no meaning.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
      // Was unset, so it ran at the default 1.0 and resampled a fresh opinion
      // every time. This is a classification, not a creative task.
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = message.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      console.log('  [AI] No text response from review');
      return jobs.map(job => ({
        jobId: job.id,
        suggestion: 'MAYBE' as AISuggestion,
        reasoning: 'Could not evaluate',
        scoreAdjustment: 0,
      }));
    }

    // Extract JSON from response (handle markdown code blocks)
    let jsonText = textBlock.text.trim();
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    }

    // Find JSON array in text
    const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    // The model writes a signed adjustment the way a person would - "+20" - and
    // JSON has no leading plus, so the whole batch threw and fell back to MAYBE.
    // A batch that fails this way still looks reviewed, so it never comes back.
    jsonText = jsonText.replace(/:\s*\+(\d)/g, ': $1');

    const results = JSON.parse(jsonText) as BatchReviewResult[];

    // Validate and fix results
    return results.map((result, i) => ({
      jobId: result.jobId || jobs[i]?.id || '',
      reach: (['realistic', 'stretch', 'moonshot'] as const).includes(result.reach as Reach)
        ? (result.reach as Reach)
        : undefined,
      suggestion: (['STRONG_FIT', 'GOOD_FIT', 'MAYBE', 'AUTO_DISMISS'].includes(result.suggestion)
        ? result.suggestion
        : 'MAYBE') as AISuggestion,
      reasoning: result.reasoning || 'No reasoning provided',
      scoreAdjustment: typeof result.scoreAdjustment === 'number'
        ? Math.max(-50, Math.min(50, result.scoreAdjustment))
        : 0,
    }));
  } catch (error) {
    console.error('  [AI] Batch review error:', error);
    // Return MAYBE for all jobs on error
    return jobs.map(job => ({
      jobId: job.id,
      suggestion: 'MAYBE' as AISuggestion,
      reasoning: 'Review failed, needs manual evaluation',
      scoreAdjustment: 0,
    }));
  }
}

export async function reviewCandidates(jobs: Job[], profile: Profile | null): Promise<AIReviewResult[]> {
  if (!profile) {
    console.log('  [AI] No profile found, skipping AI review');
    return [];
  }

  if (jobs.length === 0) {
    return [];
  }

  console.log(`  [AI] Reviewing ${jobs.length} candidates...`);

  const results: AIReviewResult[] = [];

  // Process in batches
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(jobs.length / BATCH_SIZE);

    console.log(`  [AI] Processing batch ${batchNum}/${totalBatches} (${batch.length} jobs)...`);

    const batchResults = await reviewBatch(batch, profile);
    results.push(...batchResults);

    // Small delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < jobs.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Log summary
  const summary = {
    strongFit: results.filter(r => r.suggestion === 'STRONG_FIT').length,
    goodFit: results.filter(r => r.suggestion === 'GOOD_FIT').length,
    maybe: results.filter(r => r.suggestion === 'MAYBE').length,
    autoDismiss: results.filter(r => r.suggestion === 'AUTO_DISMISS').length,
  };

  console.log(`  [AI] Review complete: ${summary.strongFit} strong, ${summary.goodFit} good, ${summary.maybe} maybe, ${summary.autoDismiss} auto-dismiss`);

  return results;
}
