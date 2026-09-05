/**
 * Split a pasted application form into questions.
 *
 * Written against six real forms - Proton on Greenhouse, METR on Lever, and
 * Granola, Perplexity, Zyphra and Langfuse on Ashby. They share no markup.
 * Lever marks required fields with a heavy asterisk, Ashby leaves "Type
 * here..." placeholders, Greenhouse gives a plain asterisk. Writing a parser
 * per platform against three samples is a losing game, so this splits on the
 * shapes all six share and expects to be corrected.
 *
 * The classification matters more than the split: a field Tim answers in two
 * seconds from memory should not sit next to one costing him twenty minutes.
 */

export type QuestionKind = 'prose' | 'decision' | 'mechanical';
export type Ats = 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'other';

export interface ParsedField {
  question: string;
  kind: QuestionKind;
  required: boolean;
  /** Present when the form states one: "in 5 sentences or less". */
  lengthLimit?: string;
  /** Choices, when the field offers options rather than free text. */
  options?: string[];
}

/** Placeholders and widget furniture, not questions. */
const NOISE = [
  /^type here\.?\.?\.?$/i,
  /^select\.?\.?\.?$/i,
  /^pick date\.?\.?\.?$/i,
  /^no file chosen$/i,
  /^upload file$/i,
  /^or drag and drop here$/i,
  /^hello@example\.com/i,
  /^1-415-555-1234/i,
  /^https?:\/\/example\.com/i,
  /^start typing\.?\.?\.?$/i,
  /^(overview|application|submit your application|autofill from resume)$/i,
  /^\d+$/,
];

/**
 * Fields Tim answers from memory in seconds. Recorded so a pasted form stays
 * whole, never surfaced for writing - the browser already autofills most.
 */
const MECHANICAL = /^(resume|resume\/cv|cv|full name|name|email|phone|phone number|contact number|current location|location|where are you currently located|current company|links?|linkedin|linkedin url|linkedin profile|github|github url|personal website|personal website url|link to github|portfolio)\b/i;

/**
 * Needs a judgement rather than a lookup - and one that changes with the role,
 * the market and the month.
 */
const DECISION = /(salary|compensation|notice period|when can you start|earliest.*start|how soon could you start|start date|relocat|sponsorship|work permit|eligibility|authorized to work|hours per week|available over what period|days a week|hybrid|from our office|willing to work from)/i;

/** A stated limit changes how an answer is used, not which answer it is. */
const LENGTH = /\b(in\s+)?(\d+\s+(sentences?|words?|characters?)\s+or\s+less|just one line|one line|max(imum)?\s+\d+\s+(words?|characters?))\b/i;

const REQUIRED = /[✱*]\s*$/;

/**
 * Option values, so they are not mistaken for questions of their own.
 * "Yes" appearing under "Do you require sponsorship?" is an answer.
 */
const OPTION_VALUE = /^(yes|no|i agree|nothing about your application|your name, email,? and resume|the above and details.*)$/i;

/**
 * A question either asks something or labels a field. Helper text does
 * neither: it is a sentence explaining the question above it, and the first
 * version of this parser turned every one into a separate question -
 * "Think of this as your super-condensed cover letter" became a field to
 * answer.
 */
function looksLikeQuestion(line: string): boolean {
  // Anywhere, not just at the end. Real questions trail off into examples:
  // "Will you have other time commitments? If so, what are they? E.g. other
  // jobs, coursework, exams, etc." ends in a full stop and is still a question,
  // and an earlier version silently swallowed every one of them as helper text.
  if (line.includes('?')) return true;
  // A field label: short, no sentence punctuation, not a fragment of prose.
  if (line.length <= 45 && !/[.!]$/.test(line) && line.split(/\s+/).length <= 7) return true;
  return false;
}

function isNoise(line: string): boolean {
  return !line || NOISE.some(p => p.test(line));
}

function classify(question: string): QuestionKind {
  if (MECHANICAL.test(question)) return 'mechanical';
  if (DECISION.test(question)) return 'decision';
  return 'prose';
}

export function detectAts(text: string): Ats {
  if (/type here\.\.\.|autofill from resume|pick date\.\.\./i.test(text)) return 'ashby';
  if (/✱/.test(text) || /submit your application/i.test(text)) return 'lever';
  if (/greenhouse/i.test(text)) return 'greenhouse';
  if (/workday/i.test(text)) return 'workday';
  return 'other';
}

export function parseForm(pasted: string): ParsedField[] {
  const lines = pasted.split('\n').map(l => l.trim());
  const fields: ParsedField[] = [];
  // Lines already used as an option or as helper text belong to the question
  // above them and must not become questions themselves.
  const consumed = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (isNoise(raw) || consumed.has(i)) continue;
    if (OPTION_VALUE.test(raw)) continue;

    const required = REQUIRED.test(raw);
    const question = raw.replace(REQUIRED, '').trim();
    if (question.length < 3 || question.length > 400) continue;
    if (!looksLikeQuestion(question)) continue;

    // Helper text sits on the line after the question and often carries the
    // limit: "In 5 sentences or less, share why you'd love to join."
    let lengthLimit: string | undefined;
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      const ahead = lines[j];
      if (!ahead || isNoise(ahead)) continue;
      // A sentence following a question is its helper text, whether or not it
      // carries a limit.
      if (!looksLikeQuestion(ahead) && !OPTION_VALUE.test(ahead)) {
        consumed.add(j);
        const m = ahead.match(LENGTH);
        if (m && !lengthLimit) lengthLimit = m[0];
      }
    }
    if (!lengthLimit) {
      const own = question.match(LENGTH);
      if (own) lengthLimit = own[0];
    }

    // Yes/No and similar option blocks follow their question directly.
    const options: string[] = [];
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const ahead = lines[j];
      if (!ahead || isNoise(ahead) || consumed.has(j)) continue;
      // Stop at the next question. Without this the scan walked past its own
      // field and collected the Yes/No belonging to the one after it.
      if (looksLikeQuestion(ahead) && !OPTION_VALUE.test(ahead)) break;
      if (OPTION_VALUE.test(ahead)) { options.push(ahead); consumed.add(j); }
      else if (options.length) break;
    }

    fields.push({
      question,
      kind: classify(question),
      required,
      lengthLimit,
      options: options.length ? options : undefined,
    });
  }

  return fields;
}
