import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Fetch the page content
    let pageContent: string;
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        return NextResponse.json(
          { error: `Failed to fetch URL: ${response.status} ${response.statusText}` },
          { status: 400 }
        );
      }

      pageContent = await response.text();
    } catch (fetchError) {
      console.error('Fetch error:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch the URL. The site may be blocking requests.' },
        { status: 400 }
      );
    }

    // Extract text content (strip HTML tags for a rough text version)
    const textContent = pageContent
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 15000); // Limit content size

    // Use Claude to extract job details
    const extractionPrompt = `Extract job posting details from this web page content. Return a JSON object with these fields:
- title: The job title
- company: The company name
- location: The job location (city, remote, etc.)
- description: The full job description (keep it detailed, include requirements, responsibilities, etc.)

If you can't find a field, use null for that field.

PAGE CONTENT:
${textContent}

Respond with ONLY valid JSON, no markdown code blocks or other text.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      messages: [{ role: 'user', content: extractionPrompt }],
    });

    const responseText = (message.content.find(b => b.type === 'text') as { type: 'text'; text: string })?.text || '';

    // Parse the JSON response
    let extracted;
    try {
      // Remove any markdown code blocks if present
      let jsonText = responseText.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```json?\s*/g, '').replace(/```\s*$/g, '');
      }
      extracted = JSON.parse(jsonText);
    } catch {
      console.error('Failed to parse extraction response:', responseText);
      return NextResponse.json(
        { error: 'Failed to extract job details from the page' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      title: extracted.title || '',
      company: extracted.company || '',
      location: extracted.location || '',
      description: extracted.description || '',
    });
  } catch (error) {
    console.error('Error fetching job URL:', error);
    return NextResponse.json({ error: 'Failed to process URL' }, { status: 500 });
  }
}
