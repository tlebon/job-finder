import Anthropic from '@anthropic-ai/sdk';
import type { Job } from './db';
import { getProfile } from './db';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function buildResumeContext(): string {
  const profile = getProfile();

  if (!profile || !profile.name) {
    // Fallback to hardcoded context if no profile exists
    return `
Tim LeBon - Frontend Web Developer based in Berlin

EXPERIENCE (6 years):
- Engineering Manager @ Wire (2024): Led web team of 6 engineers, drove cross-functional initiatives, shipped calling UI overhaul to production. Established TypeScript coding standards, oversaw infrastructure migrations.
- Senior Web Developer @ Wire (2022-2024): React/TypeScript/Electron, Project Lead for Teams Admin Platform, built Account Entropy & Blurred Background features for E2E encrypted messaging app.
- Fullstack Developer @ tz-connect (2021): Built NFT marketplace with Postgres, Nest.js, Prisma, React - smart contracts & Web3 on Tezos blockchain. Wallet integration, transaction flows, async blockchain operations.
- Software Engineer @ diconium (2019-2021): Agency work with React, TypeScript, GraphQL, Node in an Agile framework.
- Teaching Assistant @ Ironhack (2018): Mentored bootcamp students on React for their final projects.

DOMAIN EXPERTISE:
- End-to-end encrypted messaging (Wire) - deep understanding of privacy-first products
- Blockchain/Web3 (tz-connect) - NFTs, smart contracts, wallet integration, DApp development

TECH: React (expert), TypeScript (expert), Node.js, Electron, GraphQL, Nest.js, Prisma, Web3/Blockchain, AWS

UNIQUE:
- Certified meditation teacher (2-year program) - strong communication & empathy
- Active in Berlin improv comedy scene - comfortable with public speaking & thinking on feet
- Walked 1000km from Berlin to France (2025) - demonstrates commitment & endurance
- Half marathon runner (1:57:51)

LOOKING FOR: Frontend/Fullstack/Engineering Manager roles in Berlin or willing to relocate within EU
`;
  }

  // Build dynamic context from profile
  return `
${profile.name} - ${profile.title}${profile.location ? ` based in ${profile.location}` : ''}

${profile.summary ? `SUMMARY:\n${profile.summary}\n` : ''}
${profile.experience ? `EXPERIENCE:\n${profile.experience}\n` : ''}
${profile.skills ? `SKILLS: ${profile.skills}\n` : ''}
${profile.preferences ? `LOOKING FOR: ${profile.preferences}\n` : ''}
`;
}

function buildStyleGuide(): string {
  const profile = getProfile();
  const name = profile?.name || 'Timothy LeBon';

  return `
# TIM'S VOICE - WRITING STYLE GUIDE

You are writing in Tim's authentic voice. This is critical. Tim's voice is direct, honest, human, and free of AI-generated corporate speak.

## CORE VOICE PRINCIPLES

### Directness Over Diplomacy
Get to the point. No preamble, no setup, no hedging.
- NOT: "I hope this message finds you well. I wanted to reach out regarding..."
- YES: "I'm applying for the Frontend Engineer position."

### Honest Without Over-Explaining
State facts directly. No defensive justification.
- NOT: "While I may not have X, I do have Y..."
- YES: State what you have. Period.

### Short Sentences, Natural Rhythm
Write how people actually think and speak. Sentences breathe. Vary length naturally.
- Mix short punchy sentences with longer ones
- NOT: Long compound sentences with multiple clauses that try to capture complex ideas in one breath

### Strong Opinions, Clearly Stated
Take positions. No "perhaps" or "it seems" when you believe something.
- NOT: "It might be worth considering whether..."
- YES: "I want to work on products that respect user privacy."

## STRUCTURE FOR COVER LETTERS

1. Direct opening - state the position and genuine connection to company/product
2. Technical experience - specific examples of relevant work
3. Why this company - what specifically draws you to THIS role
4. Brief closing - express interest without desperation

Sign as "${name}"

## FORMAT RULES
- Plain text only - no markdown (no **bold**, no #headers, no _italics_)
- NO em dashes for asides (biggest AI tell!) - use periods instead
- NO section headers like "THE OPPORTUNITY" or "WHAT I BRING"
- Write in paragraphs, not bullet lists
- 400-500 words

## ABSOLUTELY NEVER USE (AI SLOP)

### Corporate Jargon:
"leverage", "utilize", "facilitate", "synergy", "moving forward", "circle back", "touch base", "reach out", "core competencies", "value add"

### Hedging Phrases:
"Perhaps we should...", "It might be worth...", "One could argue...", "It seems that...", "In my opinion..." (just state the opinion)

### Excessive Politeness:
"I hope this email finds you well", "Please don't hesitate to...", "I'd be happy to help", "Thank you so much for your time and consideration"

### Generic Enthusiasm:
"I am excited about...", "I am passionate about...", "I would love the chance to...", "unique opportunity", "exciting opportunity"

### Defensive Language:
"I know I'm not perfect, but...", "While I may not have X...", "Despite my lack of...", "I hope you'll overlook..."

### Other AI Patterns:
"proven track record", "hit the ground running", "dynamic environment", "think outside the box", "go above and beyond", "seasoned professional", "results-driven", "I am writing to express my interest in..."

## WHAT TIM'S VOICE SOUNDS LIKE

From actual cover letter:
"I'm applying for the AI Engineer position on the DeepL Agent team. Building agentic AI systems that solve real business problems - rather than chasing hype - is exactly where I want to focus my career right now."

From resignation letter:
"I regret to inform you that I am resigning from Wire. For the last few months, I have been having headaches. My personal doctor has attributed it to migraines due to stress. I cannot play with my health again. I need to stop."

## THE CORE DIFFERENCE

AI writing tries to be: Formally polite, comprehensive, structured, inoffensive, safe
Tim's writing is: Genuinely warm, concise, natural flow, honest, human, real

Write like a real human talking to another real human. Not like a corporate drone, an AI assistant, or someone afraid of judgment.
`;
}

function detectJobType(job: Job): { isWeb3: boolean; isPrivacy: boolean; isEM: boolean } {
  const fullText = `${job.title} ${job.description} ${job.company}`;

  const web3Patterns = [/blockchain/i, /web3/i, /crypto/i, /defi/i, /nft/i, /smart contract/i];
  const privacyPatterns = [/encrypt/i, /e2e/i, /privacy/i, /secure messaging/i];
  const emPatterns = [/engineering manager/i, /eng\.?\s*manager/i, /\bem\b/i, /team lead/i];

  return {
    isWeb3: web3Patterns.some(p => p.test(fullText)),
    isPrivacy: privacyPatterns.some(p => p.test(fullText)),
    isEM: emPatterns.some(p => p.test(job.title)),
  };
}

function getRoleSpecificGuidance(jobType: { isWeb3: boolean; isPrivacy: boolean; isEM: boolean }): string {
  let guidance = '';

  if (jobType.isWeb3) {
    guidance += `
For Web3/Blockchain roles:
- Highlight any blockchain/Web3 experience prominently
- Create a dedicated section for Web3 experience if substantial
- Mention understanding of smart contracts, wallet integration, DApp development
- Show enthusiasm for decentralized technology
`;
  }

  if (jobType.isPrivacy) {
    guidance += `
For Privacy/Security roles:
- Emphasize experience with security-focused products
- Highlight understanding of encryption, privacy-first development
- Show commitment to user privacy and security
`;
  }

  if (jobType.isEM) {
    guidance += `
For Engineering Manager/Leadership roles:
- Use a more narrative, personal style
- Tell the story of your leadership journey
- Emphasize team building, mentorship, and delivery track record
- Show philosophy on sustainable engineering and team wellbeing
`;
  }

  return guidance;
}

export async function generateCoverLetter(job: Job): Promise<{ draft: string; feedback: string; final: string }> {
  const profile = getProfile();
  const resumeContext = buildResumeContext();
  const styleGuide = buildStyleGuide();
  const jobType = detectJobType(job);
  const roleSpecificGuidance = getRoleSpecificGuidance(jobType);
  const candidateName = profile?.name || 'the candidate';

  // Step 1: Write draft
  const draftPrompt = `You are writing a cover letter for ${candidateName} applying for a job.

JOB DETAILS:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location}
- Description: ${job.description.substring(0, 3000)}

CANDIDATE'S BACKGROUND:
${resumeContext}

${styleGuide}

${roleSpecificGuidance}

INSTRUCTIONS:
1. Write a cover letter following the style guide above
2. Reference 1-2 specific things from the job description that connect to the candidate's experience
3. Sound genuine, not generic - avoid clichés like "I'm passionate about..."
4. If the job location differs from the candidate's, mention openness to relocation if relevant
5. Keep it 400-500 words

OUTPUT:
Write ONLY the cover letter text. Start with "Dear [Company] Hiring Team," and end with signature.`;

  const draftResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1500,
    messages: [{ role: 'user', content: draftPrompt }],
  });

  const draft = (draftResponse.content.find(b => b.type === 'text') as { type: 'text'; text: string })?.text || '';

  // Step 2: Review
  const reviewPrompt = `You are a hiring manager reviewing a cover letter. Be critical but constructive.

JOB: ${job.title} at ${job.company}
JOB DESCRIPTION: ${job.description.substring(0, 4000)}

COVER LETTER DRAFT:
${draft}

REVIEW CRITERIA:
1. Does it sound genuine or generic/AI-written?
2. Does it make specific connections to the job description?
3. Are there any clichés or filler phrases that should be removed?
4. Is the tone appropriate (professional but conversational)?
5. Does it highlight the most relevant experience for THIS role?
6. Is there anything that feels forced or unnatural?

OUTPUT:
Provide 3-5 specific, actionable improvements. Be direct and concrete. Format as a numbered list.`;

  const reviewResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 800,
    messages: [{ role: 'user', content: reviewPrompt }],
  });

  const feedback = (reviewResponse.content.find(b => b.type === 'text') as { type: 'text'; text: string })?.text || '';

  // Step 3: Rewrite
  const rewritePrompt = `You are rewriting a cover letter based on reviewer feedback.

JOB: ${job.title} at ${job.company} (${job.location})
JOB DESCRIPTION: ${job.description.substring(0, 4000)}

ORIGINAL DRAFT:
${draft}

REVIEWER FEEDBACK:
${feedback}

CANDIDATE'S BACKGROUND:
${resumeContext}

${styleGuide}

${roleSpecificGuidance}

CRITICAL: You MUST address EACH piece of feedback listed above. Go through them one by one:
- For each suggestion, make the specific change requested
- If feedback says to add something, add it
- If feedback says to remove something, remove it
- If feedback says to rephrase something, rephrase it

INSTRUCTIONS:
1. Address every single feedback point - do not skip any
2. Keep what's already working well
3. Maintain a professional but warm, confident but not arrogant tone
4. Keep it 400-500 words

OUTPUT:
Write ONLY the final cover letter. Start with "Dear [Company] Hiring Team," and end with signature.`;

  const finalResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1500,
    messages: [{ role: 'user', content: rewritePrompt }],
  });

  const final = (finalResponse.content.find(b => b.type === 'text') as { type: 'text'; text: string })?.text || '';

  return { draft, feedback, final };
}
