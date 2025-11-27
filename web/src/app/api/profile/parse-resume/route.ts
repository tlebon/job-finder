import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('resume') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Read file content
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const mimeType = file.type;

    let extractedText = '';

    // For PDFs, use Claude's vision capability
    if (mimeType === 'application/pdf') {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64,
              },
            },
            {
              type: 'text',
              text: `Extract all text content from this resume PDF. Return ONLY the raw text, preserving the structure as much as possible.`,
            },
          ],
        }],
      });
      extractedText = (response.content.find(b => b.type === 'text') as { type: 'text'; text: string })?.text || '';
    } else if (mimeType === 'text/plain') {
      // Plain text file
      extractedText = new TextDecoder().decode(buffer);
    } else {
      return NextResponse.json({ error: 'Unsupported file type. Please upload a PDF or TXT file.' }, { status: 400 });
    }

    // Now parse the extracted text into profile fields
    const parseResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: `Parse this resume and extract the following fields. Return ONLY valid JSON, no markdown or explanation.

RESUME TEXT:
${extractedText}

EXTRACT INTO THIS JSON STRUCTURE:
{
  "name": "Full name",
  "title": "Professional title/headline",
  "location": "City, Country",
  "email": "email@example.com",
  "phone": "phone number",
  "linkedin": "linkedin URL or username",
  "github": "github URL or username",
  "website": "personal website URL",
  "summary": "Professional summary or objective (1-2 sentences)",
  "experience": "Work experience section, preserving formatting with bullet points",
  "skills": "Comma-separated list of skills",
  "preferences": "Job preferences if mentioned, otherwise empty string"
}

Rules:
- If a field is not found, use an empty string ""
- For experience, include job titles, companies, dates, and bullet points
- For skills, create a comma-separated list
- Keep the experience section well-formatted with line breaks
- Return ONLY the JSON object, nothing else`,
      }],
    });

    const jsonText = (parseResponse.content.find(b => b.type === 'text') as { type: 'text'; text: string })?.text || '{}';

    // Parse the JSON response
    let profile;
    try {
      // Clean up potential markdown code blocks
      const cleanJson = jsonText.replace(/```json\n?|\n?```/g, '').trim();
      profile = JSON.parse(cleanJson);
    } catch {
      console.error('Failed to parse Claude response:', jsonText);
      return NextResponse.json({ error: 'Failed to parse resume content' }, { status: 500 });
    }

    return NextResponse.json({ profile, extractedText });
  } catch (err) {
    console.error('Failed to parse resume:', err);
    return NextResponse.json({ error: 'Failed to parse resume' }, { status: 500 });
  }
}
