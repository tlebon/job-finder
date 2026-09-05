import { NextResponse } from 'next/server';
import { parseForm, detectAts } from '@shared/questions/parseForm';

/**
 * Split a pasted application form into fields.
 *
 * Imports the parser from the scraper's src rather than copying it into the web
 * app. The two db layers were duplicated by convention and have drifted; a
 * parser exists to agree with its tests, and two copies would eventually
 * disagree with each other instead.
 */
export async function POST(request: Request) {
  const { text } = await request.json();
  if (typeof text !== 'string' || text.trim().length < 10) {
    return NextResponse.json({ error: 'paste a form first' }, { status: 400 });
  }

  return NextResponse.json({
    ats: detectAts(text),
    fields: parseForm(text),
  });
}
