import { NextResponse } from 'next/server';
import { getJobById } from '@/lib/db';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = getJobById(id);

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (!job.description) {
      return NextResponse.json({ error: 'No description to translate' }, { status: 400 });
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: `Translate this job description to English.

IMPORTANT RULES:
1. Preserve ALL HTML tags exactly as they are (like <p>, <ul>, <li>, <br>, <strong>, <h1>, etc.)
2. Only translate the text content inside the tags
3. Do not add any comments, explanations, or markdown formatting
4. Return ONLY the translated HTML

JOB DESCRIPTION:
${job.description}`,
        },
      ],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    const translatedDescription = textBlock && textBlock.type === 'text' ? textBlock.text : '';

    return NextResponse.json({ translatedDescription });
  } catch (error) {
    console.error('Error translating job description:', error);
    return NextResponse.json({ error: 'Failed to translate' }, { status: 500 });
  }
}
