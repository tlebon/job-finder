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
WRITING STYLE:
- Professional but genuine tone - not corporate speak
- Direct opening: state the position and show familiarity with the company/product
- Show you've researched them - reference specific products, features, or mission
- Confident without arrogance
- End with: "I'd welcome the opportunity to discuss..."
- Close with "Thank you for your consideration," and sign as "${name}"

STRUCTURE:
1. Opening paragraph: Position + genuine connection to company/product (show you know them)
2. Technical Experience section: Use bullet points for key technical details
3. Why [Company] section: What specifically excites you about THIS role/product
4. Closing: Express interest in discussing further

FORMAT:
- Do NOT use any markdown formatting (no **bold**, no headers with #, no _italics_)
- Section headers should be plain text on their own line (e.g., "Technical Background" not "**Technical Background**")
- Use bullet points (•) for technical lists - makes it scannable
- Keep paragraphs focused - one idea per paragraph
- Output plain text only - this will be exported to PDF/DOCX

LENGTH: 400-500 words - substantial but focused

ABSOLUTELY AVOID THESE AI WRITING PATTERNS:
- "I am excited to..." / "I was thrilled to..." / "I am eager to..."
- "I am confident that..." / "I firmly believe..."
- "leverage" as a verb
- "synergy" / "synergistic" / "holistic"
- "passionate about" (overused to meaninglessness)
- "unique opportunity" / "exciting opportunity"
- "hit the ground running"
- "proven track record"
- "dynamic environment" / "fast-paced environment"
- "I would be a great fit because..."
- "I am writing to express my interest in..."
- "seasoned professional" / "results-driven"
- "think outside the box" / "go above and beyond"
- "team player" without specific examples
- Starting multiple sentences with "I"
- Vague superlatives without evidence

INSTEAD:
- Write like a real person, not a press release
- Use specific examples instead of vague claims
- Vary sentence structure and length
- Show, don't tell - if you're collaborative, describe a collaboration
- Be direct about what you did, not what you "helped" with
- Confidence without desperation - they need good people too
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
