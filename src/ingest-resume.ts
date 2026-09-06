#!/usr/bin/env tsx
/**
 * Ingest resume bullets as evidence chunks.
 *
 * Different material from the cover letters, and used differently. A CV bullet
 * is compressed evidence - "943-dim embeddings combining text, artist-graph and
 * audio features" - where letter prose is argument. The bullets are the raw
 * stock for questions like "what's the best evidence you'd be great in this
 * position" and "do you have experience with X", both of which are sitting
 * unanswered in the bank right now.
 *
 * They are marked voice_eligible = 0 deliberately. CV register is fragments,
 * no pronouns, achievement-first - true about Tim, and a terrible model for how
 * he writes. Serving them as voice exemplars is how the voice drifts. Same
 * distinction the chunk store already draws between the voice corpus and the
 * facts corpus.
 *
 * Usage:
 *   npx tsx src/ingest-resume.ts --dry-run
 *   npx tsx src/ingest-resume.ts --confirm          (local, from the PDFs)
 *   npx tsx src/ingest-resume.ts --export           (write the extract to JSON)
 *   npx tsx src/ingest-resume.ts --from-json --confirm   (production)
 *
 * The PDFs live on Tim's machine and the container has never seen them, so the
 * extract is committed as JSON and production ingests from that - the same
 * pattern the cover letters already use with their manifest.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { initChunkStore, insertChunk, type RoleTrack } from './storage/chunks.js';
import { db } from './storage/db.js';

config({ quiet: true });

const confirm = process.argv.includes('--confirm');
const doExport = process.argv.includes('--export');
const fromJson = process.argv.includes('--from-json');

const EXTRACT = join(dirname(fileURLToPath(import.meta.url)), 'data', 'resume-evidence.json');

/**
 * Current variants and older ones both.
 *
 * Tim keeps a track per audience - IC, science-leaning, management - which is
 * what the roleTrack field was for. Older resumes are included deliberately:
 * they carry achievements since trimmed for space, and a bullet dropped from
 * the current CV is still true and still the right answer to some question. The
 * date travels with the chunk so recency stays visible.
 */
const HOME = process.env.HOME;
const SOURCES: { file: string; track: RoleTrack; label: string; date: string }[] = [
  { file: `${HOME}/Downloads/timothy_lebon_resume_2026_v9.pdf`, track: 'ic', label: 'resume-2026-v9', date: '2026' },
  { file: `${HOME}/Downloads/timothy_lebon_resume_2026_v9_science_leaning.pdf`, track: 'ic', label: 'resume-2026-v9-science', date: '2026' },
  { file: `${HOME}/Downloads/timothy_lebon_resume_EM.pdf`, track: 'em', label: 'resume-2026-em', date: '2026' },
  { file: `${HOME}/Downloads/timothy_lebon_resume_2026_v8_science.pdf`, track: 'ic', label: 'resume-2026-v8-science', date: '2026' },
  { file: `${HOME}/Downloads/timothy_lebon_resume_2026_v6.pdf`, track: 'ic', label: 'resume-2026-v6', date: '2026' },
  // Pre-pivot. The frontend and blockchain work, in more detail than the
  // current versions have room for.
  { file: 'data/resume.txt', track: 'both', label: 'resume-2025', date: '2025' },
  { file: `${HOME}/Documents/freelance visa docs/timothy lebon web dev resume 31.10.pdf`, track: 'ic', label: 'resume-webdev-older', date: '2021' },
  { file: `${HOME}/Documents/freelance visa docs/tim resume edits.pdf`, track: 'ic', label: 'resume-edits-older', date: '2021' },
];

/** Contact details are not evidence, and there is no reason to store them. */
const PII = /(@|\+\d{2}\s|linkedin\.com|github\.com|\bstar-dog\b|\+49)/i;

function extract(file: string): string {
  if (file.endsWith('.txt')) return readFileSync(file, 'utf8');
  return execFileSync(process.env.PY ?? 'ml/.venv/bin/python',
    ['-c', `import pypdf,sys;r=pypdf.PdfReader(sys.argv[1]);print("\\n".join(p.extract_text() or "" for p in r.pages))`, file],
    { encoding: 'utf8', maxBuffer: 10_000_000 });
}

/**
 * A section heading, not a continuation of the bullet above it.
 *
 * Bullets wrap mid-sentence in the extracted text, so continuations have to be
 * joined - but the naive version swallowed the next job title too, producing
 * "Managed a team of 5 engineers while staying hands-on with development Senior
 * Frontend Developer". A heading is short, title-cased or capitalised, and
 * carries no sentence punctuation; a genuine continuation almost always has a
 * comma or runs long.
 */
function isHeading(line: string): boolean {
  if (/^[A-Z][A-Z\s/&]{4,}$/.test(line)) return true;          // ALL CAPS section
  if (line.includes('|')) return true;                          // company | dates
  // A closing bracket means this finishes a clause above it, not a title.
  // Without this, "Prisma)" read as a heading and cut a bullet off at
  // "...NestJS, PostgreSQL,".
  if (/[)\]]/.test(line)) return false;
  if (/^[a-z]/.test(line)) return false;                        // clearly a continuation
  return line.length < 55 && !/[,.;:]/.test(line) && /^[A-Z]/.test(line);
}

/**
 * Bullets wrap across lines in the extracted text, so a continuation is any
 * line that neither starts a new bullet nor looks like a heading.
 */
function bullets(text: string): string[] {
  const out: string[] = [];
  let current = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^[•\-·]\s/.test(line)) {
      if (current) out.push(current);
      current = line.replace(/^[•\-·]\s*/, '');
    } else if (current && line && (/[,(\-]$/.test(current) || !isHeading(line))) {
      // A bullet ending in a comma, open bracket or hyphen is mid-clause, so
      // whatever follows continues it whatever shape it has.
      current += ' ' + line;
    } else if (current) {
      out.push(current);
      current = '';
    }
  }
  if (current) out.push(current);
  return out.map(b => b.replace(/\s+/g, ' ').trim())
    .filter(b => b.length > 40 && !PII.test(b));
}

initChunkStore();

if (fromJson) {
  const rows = JSON.parse(readFileSync(EXTRACT, 'utf8')) as
    { content: string; track: RoleTrack; label: string; date: string }[];
  const seen = new Set(
    (db.prepare("SELECT content FROM chunks WHERE slot = 'evidence'").all() as { content: string }[])
      .map(r => r.content.toLowerCase().replace(/\s+/g, ' ').trim())
  );
  const add = rows.filter(r => !seen.has(r.content.toLowerCase().replace(/\s+/g, ' ').trim()));
  console.log(`${rows.length} in the extract, ${add.length} new`);
  if (!confirm) {
    console.log('DRY RUN: pass --confirm.');
    process.exit(0);
  }
  for (const r of add) {
    insertChunk({
      level: 'paragraph', slot: 'evidence', content: r.content,
      provenance: 'tim', sourceLetter: r.label, sourceDate: r.date,
      roleTrack: r.track, tags: [], voiceEligible: false,
    });
  }
  console.log(`Ingested ${add.length} evidence chunks.`);
  process.exit(0);
}

const existing = new Set(
  (db.prepare("SELECT content FROM chunks WHERE slot = 'evidence'").all() as { content: string }[])
    .map(r => r.content.toLowerCase().replace(/\s+/g, ' ').trim())
);

interface Bullet { content: string; track: RoleTrack; label: string; date: string }

const wordsOf = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);

/** Share of the shorter bullet's words that the longer one also has. */
function overlap(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  if (!small.size) return 0;
  let shared = 0;
  for (const w of small) if (large.has(w)) shared++;
  return shared / small.size;
}

let found = 0;
/** Everything extracted, deduplicated across variants. What --export writes. */
const all: Bullet[] = [];
/** Only what is not already stored. What --confirm ingests. */
const fresh: Bullet[] = [];
const seenHere = new Set<string>();

for (const src of SOURCES) {
  if (!existsSync(src.file)) {
    console.log(`missing: ${src.file}`);
    continue;
  }
  const list = bullets(extract(src.file));
  found += list.length;
  for (const content of list) {
    const key = content.toLowerCase().replace(/\s+/g, ' ').trim();
    // The variants share most bullets. First sighting wins and SOURCES is
    // ordered newest first, so a bullet still in the current CV is credited to
    // it rather than to an older draft.
    if (seenHere.has(key)) continue;

    // Near-duplicates, not just exact ones. The CV variants reword the same
    // achievement - "Built a CI/CD pipeline with code signing and notarization
    // for a new Electron client" against the same sentence plus "; delivered
    // multiple on-time releases" - and exact matching kept both, so the sidebar
    // showed one achievement three times. Keep the fullest version.
    const mine = wordsOf(content);
    let supersededBy = -1;
    for (let i = 0; i < all.length; i++) {
      if (overlap(mine, wordsOf(all[i].content)) > 0.8) { supersededBy = i; break; }
    }
    if (supersededBy >= 0) {
      if (content.length > all[supersededBy].content.length) {
        all[supersededBy] = { content, track: src.track, label: src.label, date: src.date };
      }
      continue;
    }

    seenHere.add(key);
    const bullet = { content, track: src.track, label: src.label, date: src.date };
    all.push(bullet);
    // The export writes everything; only the ingest skips what is already
    // stored. Conflating the two made --export emit nothing once the local
    // database had been populated.
    if (!existing.has(key)) fresh.push(bullet);
  }
  console.log(`${src.label.padEnd(24)} ${list.length} bullets`);
}

console.log(`\n${found} bullets across the variants, ${all.length} distinct, ${fresh.length} new\n`);
for (const f of fresh) console.log(`  [${f.date}][${f.track}] ${f.content.slice(0, 84)}`);

if (doExport) {
  writeFileSync(EXTRACT, JSON.stringify(all, null, 2) + '\n');
  console.log(`\nWrote ${all.length} bullets to ${EXTRACT}`);
  process.exit(0);
}

if (!confirm) {
  console.log('\nDRY RUN: pass --confirm to ingest, or --export to write JSON for production.');
  process.exit(0);
}

for (const f of fresh) {
  insertChunk({
    level: 'paragraph',
    slot: 'evidence',
    content: f.content,
    // His words, and factual. Not a voice exemplar: see the note above.
    provenance: 'tim',
    sourceLetter: f.label,
    sourceDate: f.date,
    roleTrack: f.track,
    tags: [],
    voiceEligible: false,
  });
}
console.log(`\nIngested ${fresh.length} evidence chunks.`);
