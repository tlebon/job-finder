import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config.js';
import type { CoverLetterContext } from '../types.js';

const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

// Learning mechanism: accumulate lessons from reviewer feedback
const learnedLessons: string[] = [];
const MAX_LESSONS = 10; // Keep the most recent lessons to avoid prompt bloat

function getLearnedLessonsContext(): string {
  if (learnedLessons.length === 0) return '';
  return `
LESSONS FROM PREVIOUS REVIEWS (apply these to avoid repeating mistakes):
${learnedLessons.map((lesson, i) => `${i + 1}. ${lesson}`).join('\n')}
`;
}

async function extractLessons(feedback: string): Promise<string[]> {
  const prompt = `Extract 1-3 generalizable lessons from this cover letter feedback that would apply to future letters.
Focus on recurring themes that should be remembered, not job-specific details.

FEEDBACK:
${feedback}

OUTPUT FORMAT (JSON array of short lessons, max 15 words each):
["lesson 1", "lesson 2"]

Examples of good lessons:
- "Frame EM-to-IC transition as strategic choice, not retreat"
- "Don't mention meditation teacher - it undermines technical narrative"
- "Start with engaging hook, not 'I'm writing to apply'"
- "Show don't tell - give concrete examples instead of claiming qualities"`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = message.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return [];

    const lessons = JSON.parse(textBlock.text);
    return Array.isArray(lessons) ? lessons : [];
  } catch {
    return [];
  }
}

function addLessons(newLessons: string[]): void {
  for (const lesson of newLessons) {
    // Avoid duplicates (simple string match)
    const isDuplicate = learnedLessons.some(
      existing => existing.toLowerCase().includes(lesson.toLowerCase().slice(0, 20)) ||
                  lesson.toLowerCase().includes(existing.toLowerCase().slice(0, 20))
    );
    if (!isDuplicate) {
      learnedLessons.push(lesson);
    }
  }
  // Keep only the most recent lessons
  while (learnedLessons.length > MAX_LESSONS) {
    learnedLessons.shift();
  }
}

export function getLessonsCount(): number {
  return learnedLessons.length;
}

export function getLessons(): string[] {
  return [...learnedLessons];
}

const RESUME_CONTEXT = `
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

const STYLE_GUIDE = `
WRITING STYLE:
- Professional but genuine tone - not corporate speak
- Direct opening: state the position and show familiarity with the company/product
- Show you've researched them - reference specific products, features, or mission
- Confident without arrogance
- For IC roles after being EM: frame it as intentional choice, not retreat
- End with: "I'd welcome the opportunity to discuss..."
- Close with "Thank you for your consideration," and sign as "Timothy LeBon"

STRUCTURE:
1. Opening paragraph: Position + genuine connection to company/product (show you know them)
2. Technical Experience section: Use bullet points for key technical details
   - Smart contract interactions, wallet connections, etc. for Web3
   - TypeScript, React, specific frameworks for frontend
3. Why [Company] section: What specifically excites you about THIS role/product
   - Reference their actual products/mission
   - Show genuine enthusiasm, not generic praise
4. Closing: Express interest in discussing further

FORMAT:
- Use clear section headers to organize (e.g., "Web3 Development Experience")
- Use bullet points (•) for technical lists - makes it scannable
- Keep paragraphs focused - one idea per paragraph

LENGTH: 450-550 words - substantial but focused
`;

const WEB3_SECTION = `
For Web3/Blockchain roles, create a "Web3 Development Experience" section with:
- At tz-connect: built frontend applications for NFT marketplace on Tezos blockchain
- Bullet points for technical details:
  • Smart contract interactions (wallet connections via Temple/MetaMask, transaction flows, blockchain state management)
  • Handling complexities of asynchronous blockchain operations in UI - pending transactions, confirmations, error states
  • Building user experiences that make Web3 feel approachable rather than intimidating
- Mention hackathon participation, Solidity/Hardhat learning for smart contract understanding
- Key phrase: "This combination of production experience and exploratory learning gives me the context to work effectively across the full Web3 stack"
`;

const PRIVACY_SECTION = `
For Privacy/Encrypted messaging roles, emphasize:
- 3 years at Wire building E2E encrypted collaboration platform
- Deep understanding of privacy-first product development
- Experience with secure communication protocols
- User trust and security as core values
`;

const EM_SECTION = `
For Engineering Manager roles, use a more narrative/personal style:
- Create "My Engineering Leadership Journey" section telling the story:
  - Joined Wire when web team was just 3 people facing significant challenges
  - Successfully rebuilt and scaled the team
  - Found genuine fulfillment in mentoring developers and creating environment where team could thrive
  - Shipped major initiatives like MLS encryption standard transition
- Create "A Unique Perspective on Leadership" section:
  - Trained meditation teacher background brings broader perspective
  - Belief that sustainable engineering excellence comes from psychological safety, room to experiment, healthy work-life balance
  - Having experienced burnout firsthand, committed to building teams that deliver without sacrificing wellbeing
- Include bullet points for concrete leadership skills:
  • Proven ability to build and scale engineering teams through challenging periods
  • Deep technical experience with TypeScript, React, Redux, complex systems
  • Leadership philosophy centered on sustainable excellence and team wellbeing
  • Strong project management skills with track record of delivering major initiatives
`;

async function writeDraft(context: CoverLetterContext, roleSpecificGuidance: string): Promise<string> {
  const { jobTitle, company, location, jobDescription } = context;

  const lessonsContext = getLearnedLessonsContext();

  const prompt = `You are writing a cover letter for Tim LeBon applying for a job.

JOB DETAILS:
- Title: ${jobTitle}
- Company: ${company}
- Location: ${location}
- Description: ${jobDescription.substring(0, 3000)}

TIM'S BACKGROUND:
${RESUME_CONTEXT}

${STYLE_GUIDE}

${roleSpecificGuidance}
${lessonsContext}
INSTRUCTIONS:
1. Write a cover letter following the style guide above
2. Reference 1-2 specific things from the job description that connect to Tim's experience
3. If applying for an IC role, naturally address the transition from EM back to IC
4. If the job is not in Berlin, mention being open to relocation
5. Sound genuine, not generic - avoid clichés like "I'm passionate about..."
6. Keep it concise (250-400 words)
${lessonsContext ? '7. Apply the lessons from previous reviews to avoid repeating past mistakes' : ''}

OUTPUT:
Write ONLY the cover letter text. Start with "Dear [Company] Hiring Team," and end with signature.`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = message.content.find(block => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude (writer)');
  }
  return textBlock.text;
}

async function reviewDraft(draft: string, context: CoverLetterContext): Promise<string> {
  const { jobTitle, company, jobDescription } = context;

  const prompt = `You are a hiring manager reviewing a cover letter. Be critical but constructive.

JOB: ${jobTitle} at ${company}
JOB DESCRIPTION EXCERPT: ${jobDescription.substring(0, 1500)}

COVER LETTER DRAFT:
${draft}

REVIEW CRITERIA:
1. Does it sound genuine or generic/AI-written?
2. Does it make specific connections to the job description?
3. Are there any clichés or filler phrases that should be removed?
4. Is the tone appropriate (professional but conversational)?
5. Does it highlight the most relevant experience for THIS role?
6. Is there anything that feels forced or unnatural?
7. Are there missed opportunities to connect Tim's experience to the role?

OUTPUT:
Provide 3-5 specific, actionable improvements. Be direct and concrete. Format as a numbered list.
Focus on the most impactful changes - don't nitpick minor things.`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = message.content.find(block => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude (reviewer)');
  }
  return textBlock.text;
}

async function rewriteWithFeedback(
  draft: string,
  feedback: string,
  context: CoverLetterContext,
  roleSpecificGuidance: string
): Promise<string> {
  const { jobTitle, company, location, jobDescription } = context;

  const prompt = `You are rewriting a cover letter based on reviewer feedback.

JOB: ${jobTitle} at ${company} (${location})
JOB DESCRIPTION: ${jobDescription.substring(0, 2000)}

ORIGINAL DRAFT:
${draft}

REVIEWER FEEDBACK:
${feedback}

TIM'S BACKGROUND:
${RESUME_CONTEXT}

${STYLE_GUIDE}

${roleSpecificGuidance}

INSTRUCTIONS:
1. Rewrite the cover letter incorporating the reviewer's feedback
2. Keep what's already working well
3. Fix the specific issues mentioned
4. Maintain Tim's voice - professional but warm, confident but not arrogant
5. Keep it 250-400 words

OUTPUT:
Write ONLY the final cover letter. Start with "Dear [Company] Hiring Team," and end with signature.`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = message.content.find(block => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude (rewriter)');
  }
  return textBlock.text;
}

export async function checkRelevance(context: CoverLetterContext): Promise<{ relevant: boolean; reason: string }> {
  const { jobTitle, company, location, jobDescription } = context;

  const prompt = `You are helping Tim LeBon (a frontend/fullstack developer with 6 years experience, based in Berlin) decide if a job is worth applying to.

JOB:
- Title: ${jobTitle}
- Company: ${company}
- Location: ${location}
- Description: ${jobDescription.substring(0, 2000)}

TIM'S BACKGROUND:
${RESUME_CONTEXT}

EVALUATE:
1. Is this role a genuine match for Tim's skills and experience?
2. Is the seniority level appropriate (mid to senior, not junior or staff/principal)?
3. Is the tech stack relevant (React/TypeScript/frontend/fullstack)?
4. Any red flags (seems like spam, unrelated field, requires skills Tim doesn't have)?

OUTPUT FORMAT (JSON only, no other text):
{"relevant": true/false, "reason": "brief explanation"}`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = message.content.find(block => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    return { relevant: true, reason: 'Could not evaluate' };
  }

  try {
    // Try to extract JSON from the response (handles markdown code blocks, extra text, etc.)
    let jsonText = textBlock.text.trim();

    // Remove markdown code blocks if present
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    }

    // Try to find JSON object in the text
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    const result = JSON.parse(jsonText);
    return { relevant: result.relevant, reason: result.reason };
  } catch (error) {
    // Log the actual response for debugging
    console.log(`  [AI] Relevance check parse error. Raw response: "${textBlock.text.substring(0, 200)}..."`);
    // If JSON parsing fails, assume relevant
    return { relevant: true, reason: 'Parse error, assuming relevant' };
  }
}

export async function generateCoverLetter(context: CoverLetterContext): Promise<string> {
  const { isWeb3Role, isPrivacyRole, isEMRole } = context;

  let roleSpecificGuidance = '';
  if (isWeb3Role) roleSpecificGuidance += WEB3_SECTION + '\n';
  if (isPrivacyRole) roleSpecificGuidance += PRIVACY_SECTION + '\n';
  if (isEMRole) roleSpecificGuidance += EM_SECTION + '\n';

  try {
    // Show current lessons count
    if (learnedLessons.length > 0) {
      console.log(`  [AI] Writer has ${learnedLessons.length} lessons from previous reviews`);
    }

    console.log('  [AI] Writing initial draft...');
    const draft = await writeDraft(context, roleSpecificGuidance);
    console.log('\n  --- DRAFT ---');
    console.log(draft.split('\n').map(l => '  ' + l).join('\n'));

    console.log('\n  [AI] Reviewing draft...');
    const feedback = await reviewDraft(draft, context);
    console.log('\n  --- REVIEWER FEEDBACK ---');
    console.log(feedback.split('\n').map(l => '  ' + l).join('\n'));

    // Extract and store lessons from feedback for future letters
    console.log('\n  [AI] Extracting lessons from feedback...');
    const newLessons = await extractLessons(feedback);
    if (newLessons.length > 0) {
      addLessons(newLessons);
      console.log(`  [AI] Learned ${newLessons.length} new lesson(s): ${newLessons.join('; ')}`);
    }

    console.log('\n  [AI] Rewriting with feedback...');
    const finalLetter = await rewriteWithFeedback(draft, feedback, context, roleSpecificGuidance);
    console.log('\n  --- FINAL LETTER ---');
    console.log(finalLetter.split('\n').map(l => '  ' + l).join('\n'));
    console.log('\n');

    return finalLetter;
  } catch (error) {
    console.error('Error generating cover letter:', error);
    throw error;
  }
}
