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
 * Five jobs per call.
 *
 * Briefly dropped to two, on the theory that batch context was driving the
 * reviewer's 50% self-agreement. That was measured under temperature 1.0, and
 * setting temperature to 0 addressed the same problem for free - the smaller
 * batch was never re-measured against that baseline, and it tripled the call
 * count while repeating the ~1,000-token instruction block on every call. Over
 * one day of re-reviews it cost several euro for an unverified gain.
 *
 * If batch context turns out to matter after all, measure it with
 * eval-reviewer-consistency at temperature 0 before paying for it again.
 */
const BATCH_SIZE = 5;

/**
 * Which model reviews. Swappable, because this is classification against a
 * fixed rubric rather than open reasoning, and the cheaper tier may well match
 * it - a question to settle with ml/compare_models.ts against Tim's own labels
 * rather than by argument. Cover letter generation stays on Sonnet; that is
 * writing, where the tier shows.
 */
const REVIEW_MODEL = process.env.REVIEW_MODEL || 'claude-sonnet-4-5-20250929';

/**
 * Thrown when review cannot proceed at all - no credit, bad key, no access.
 *
 * Distinct from a batch that merely failed to parse. A transient failure can
 * fall back to MAYBE and be retried later; a systemic one must stop the run,
 * because the fallback marks jobs reviewed and they never return.
 */
export class ReviewUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewUnavailableError';
  }
}

async function reviewBatch(jobs: Job[], profile: Profile): Promise<BatchReviewResult[]> {
  const jobDescriptions = jobs.map((job, i) => `
JOB ${i + 1} (ID: ${job.id}):
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location}
- Description: ${excerptForReview(job.description) || 'No description'}
`).join('\n---\n');

  // Split so the constant half can be cached. Everything above the postings is
  // identical on every call - instructions, criteria, output format and the
  // profile - and is most of the input once five jobs share one call. The
  // postings move to the end because a cache prefix has to be a prefix.
  const systemPrompt = `You are helping a job seeker review job listings to determine which ones are worth applying to.

CANDIDATE PROFILE:
- Current Title: ${profile.title}
- Location: ${profile.location}
- Skills: ${profile.skills}
- Experience: ${profile.experience?.substring(0, 1000) || 'Not provided'}
- Preferences: ${profile.preferences || 'No specific preferences noted'}

The question is whether the candidate would CONSIDER APPLYING - not whether they
are the strongest applicant. Those differ, and for someone mid-career-change they
often point opposite ways.

This candidate is changing direction. A role asking for skills they are actively
building is the target, not a mismatch. Do not penalise a posting for requiring
experience they are in the middle of acquiring, and do not reward a posting
merely for matching what they did three years ago.

What genuinely rules a job out. These apply REGARDLESS of the employer - a
role at an admired company is still ruled out if one of them holds, and the
company name is never a reason to override them:
- A different profession. Sales, recruiting, marketing, design, legal, customer
  success, account management, product management, programme management.
  If the person in this role does not write code, it is AUTO_DISMISS.
- A hard language requirement they do not meet (fluent or native German as a
  stated requirement; "German a plus" is fine).
- A doctorate or equivalent research record stated as required.
- Purely managerial with no hands-on engineering. A title containing Manager,
  Head of, Director or VP is AUTO_DISMISS unless the posting clearly describes
  hands-on engineering work. Engineering Manager at a small company can qualify;
  Tech Lead Manager of a platform team usually does not.
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

SECOND, and independently, how far a reach is it? Judge this against the
requirements the posting actually states, not against the company's reputation.

- realistic: their background plausibly clears the stated bar. Most postings
  that fit their field at all belong here.
- stretch: a credible but not obvious candidate. Missing some stated experience,
  or a clear step up in scope.
- moonshot: a genuine long shot. Reserve this for postings demanding far more
  than they have - roughly double their years, a publication record, or deep
  specialisation they lack entirely.

Reach is about the odds, not the appeal, and the two are independent: a dream
job can be STRONG_FIT and moonshot at once, and that pairing is exactly what is
useful to record.

Calibrate. If you are marking most jobs moonshot the scale has collapsed and
carries no information. A well-known employer alone does not make a posting a
moonshot; the stated requirements do.

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

  const prompt = `JOBS TO REVIEW:
${jobDescriptions}

Return the JSON array now, one object per job, in the order given.`;

  try {
    const message = await anthropic.messages.create({
      model: REVIEW_MODEL,
      max_tokens: 2000,
      // Was unset, so it ran at the default 1.0 and resampled a fresh opinion
      // every time. This is a classification, not a creative task.
      temperature: 0,
      // The instructions and profile are identical on every call and account
      // for most of the input tokens once batching spreads the job text across
      // five postings. Caching that block cuts the repeated cost by roughly 90%
      // on a hit, which matters when a full pass is 500+ calls.
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
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
    // An outage is not a verdict. Falling back to MAYBE writes a fabricated
    // answer AND marks the job reviewed, so it never comes back - which is how
    // an exhausted credit balance silently overwrote 892 real verdicts with
    // MAYBE. Anything that will not fix itself on the next batch aborts the run.
    const message = error instanceof Error ? error.message : String(error);
    if (/credit balance|authentication|invalid x-api-key|permission|not_found_error/i.test(message)) {
      console.error('\n  [AI] Aborting: this will not resolve by retrying.');
      console.error(`  [AI] ${message.slice(0, 200)}`);
      throw new ReviewUnavailableError(message);
    }

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
