import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config.js';
import type { Job } from '../types.js';
import type { AIReviewResult, AISuggestion } from '../storage/db.js';

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
  reasoning: string;
  scoreAdjustment: number;
}

const BATCH_SIZE = 5; // Process 5 jobs per API call for efficiency

async function reviewBatch(jobs: Job[], profile: Profile): Promise<BatchReviewResult[]> {
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

    const results = JSON.parse(jsonText) as BatchReviewResult[];

    // Validate and fix results
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
