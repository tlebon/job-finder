/**
 * Job descriptions arrive as HTML, and some sources double-escape it, so a
 * stored description can begin with literal `&lt;p class=&quot;...&gt;`. Left
 * as-is, that markup eats a large share of any truncation window and the model
 * reads tag soup instead of the posting.
 *
 * Clean at ingestion so every downstream consumer gets plain text.
 */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(input: string): string {
  let out = input;
  // Two passes: sources like Proton double-escape, so one pass leaves `<p ...>`.
  for (let i = 0; i < 2; i++) {
    out = out.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, m => ENTITIES[m] ?? m);
  }
  return out;
}

/** Decode entities, drop tags, and collapse whitespace. */
export function cleanJobDescription(raw: string | null | undefined): string {
  if (!raw) return '';

  let text = decodeEntities(raw);

  // Keep block boundaries as newlines so structure survives tag removal.
  text = text.replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<li[^>]*>/gi, '\n- ');
  text = text.replace(/<[^>]+>/g, '');

  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');
}

/**
 * Most postings open with company boilerplate ("Join X and build a better
 * internet..."), so a naive head-truncation shows the reviewer an About Us page
 * and none of the requirements. Prefer the section that actually describes the
 * job when one is identifiable.
 */
const REQUIREMENT_MARKERS = /(what you'?ll do|responsibilities|your role|the role|what we'?re looking for|requirements|qualifications|your profile|about the (job|role|position)|tech stack|you will)/i;

export function excerptForReview(raw: string | null | undefined, limit = 6000): string {
  const text = cleanJobDescription(raw);
  if (text.length <= limit) return text;

  const match = text.match(REQUIREMENT_MARKERS);
  if (match && match.index !== undefined) {
    // Keep a little lead-in for context, then the requirements themselves.
    const start = Math.max(0, match.index - 200);
    return text.slice(start, start + limit);
  }

  return text.slice(0, limit);
}

/**
 * The part of a posting that describes the role rather than the company.
 *
 * Postings open with a blurb - at an AI company that blurb names Claude, LLMs
 * and machine learning on every listing from Cash Manager upward - so reading
 * role signal from the whole description reads the company instead. Returns the
 * text from the requirements section onward when one is identifiable, and an
 * empty string when it is not: better to fall back on the title alone than to
 * award full confidence to text we cannot place. Roughly 55% of live postings
 * have a locatable section.
 */
export function roleSection(raw: string | null | undefined): string {
  const text = cleanJobDescription(raw);
  if (!text) return '';

  const match = text.match(REQUIREMENT_MARKERS);
  if (!match || match.index === undefined) return '';

  return text.slice(match.index);
}
