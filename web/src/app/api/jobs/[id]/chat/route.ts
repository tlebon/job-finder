import { NextRequest, NextResponse } from 'next/server';
import { getJobById, getProfile } from '@/lib/db';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { messages, coverLetter } = await request.json() as {
      messages: ChatMessage[];
      coverLetter: string;
    };

    const job = getJobById(id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const profile = getProfile();

    // Build context for the AI
    const systemPrompt = `You are a helpful assistant helping a job applicant refine their cover letter.

JOB DETAILS:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location}
- Description: ${job.description?.substring(0, 2000) || 'Not available'}

APPLICANT PROFILE:
${profile ? `
- Name: ${profile.name}
- Title: ${profile.title}
- Skills: ${profile.skills}
- Experience: ${profile.experience?.substring(0, 1000) || 'Not provided'}
` : 'No profile available'}

CURRENT COVER LETTER:
${coverLetter || 'No cover letter written yet'}

INSTRUCTIONS:
- Help the user improve their cover letter through conversation
- When they ask for changes, provide the COMPLETE updated letter (not just the changed parts)
- When providing an updated letter, wrap it in <suggested_letter>...</suggested_letter> tags
- Be specific and actionable in your suggestions
- Keep the letter professional but genuine, not corporate-speak
- Target length: 400-500 words`;

    // Convert messages to Anthropic format
    const anthropicMessages = messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
      system: systemPrompt,
      messages: anthropicMessages,
    });

    const textBlock = response.content.find(b => b.type === 'text');
    const reply = textBlock && textBlock.type === 'text' ? textBlock.text : '';

    // Extract suggested letter if present
    const suggestedLetterMatch = reply.match(/<suggested_letter>([\s\S]*?)<\/suggested_letter>/);
    const suggestedEdit = suggestedLetterMatch ? suggestedLetterMatch[1].trim() : undefined;

    // Clean the reply (remove the tags for display)
    const cleanReply = reply.replace(/<suggested_letter>[\s\S]*?<\/suggested_letter>/g, '').trim();

    return NextResponse.json({
      reply: cleanReply || (suggestedEdit ? "Here's the updated letter:" : reply),
      suggestedEdit,
    });
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json({ error: 'Failed to process chat' }, { status: 500 });
  }
}
