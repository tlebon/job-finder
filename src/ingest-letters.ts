#!/usr/bin/env tsx
/**
 * Ingest cover letters into the chunk library.
 *
 * Provenance comes from data/examples/voice/MANIFEST.json and is never guessed.
 * Only pre-ChatGPT letters (voice_eligible) are servable as voice exemplars;
 * everything else is stored for reference and fact-mining only.
 *
 * Usage:
 *   npx tsx src/ingest-letters.ts --dry-run
 *   npx tsx src/ingest-letters.ts --confirm
 */

import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { insertChunk, chunkStats, type Slot, type Provenance, type RoleTrack } from './storage/chunks.js';

config({ quiet: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(__dirname, '..', 'data', 'examples', 'voice');

interface ManifestEntry {
  file: string;
  date: string;
  provenance: Provenance;
  company: string;
  voice_eligible: boolean;
  mine_facts_only?: boolean;
}

/**
 * Slot classification. Ordered: first match wins, so put the specific patterns
 * above the general ones.
 */
const SLOT_RULES: Array<{ slot: Slot; test: RegExp }> = [
  { slot: 'salutation',        test: /^(hey|hi|dear|hello)\b[^.!?]{0,40}[,!]?\s*$/i },
  { slot: 'logistics',         test: /(based in berlin|available to start|working visa|my german is|happy to come by)/i },
  { slot: 'opening',           test: /^(i am interested in your|i'?m applying for|i'?m writing to apply|i'?m interested in)/i },
  { slot: 'career_background', test: /(pharmaceutical chemistry|joined a bootcamp|switch careers|left chemistry|both my parents|before i was a software engineer)/i },
  // why_company must outrank closing: the final paragraph frequently carries
  // both the pitch and the sign-off, and the pitch is the reusable part.
  { slot: 'why_company',       test: /(this is why i have a lot of interest|what excites me|what draws me|sounds like an exciting place|caught my eye|is the kind of problem|what caught my attention)/i },
  { slot: 'closing',           test: /(thanks for your time|thank you for your consideration|i'?d love to chat|speak more soon|looking forward to hearing)/i },
  { slot: 'current_role',      test: /(currently,? i am|most recently|at wire|at tz-connect|i am a full-?stack|our tech stack|i have \d+ years|6\+? years)/i },
  { slot: 'domain_interest',   test: /(blockchain|web3|decentralized|i love to daydream|crypto|machine learning|data science retreat|pytorch)/i },
];

function classifySlot(text: string, index: number, total: number): Slot {
  // Position is a strong prior in these letters; regex refines it.
  if (index === 0 && /^(hey|hi|dear|hello)\b/i.test(text) && text.length < 60) return 'salutation';
  if (index === total - 1 && text.split(' ').length < 12) return 'closing';

  for (const rule of SLOT_RULES) {
    if (rule.test.test(text)) return rule.slot;
  }
  // Unmatched middle paragraphs are experience, not domain enthusiasm.
  return index < total / 2 ? 'career_background' : 'current_role';
}

function inferRoleTrack(text: string): RoleTrack {
  const em = /(managed a team|engineering manager|mentoring developers|performance management|hiring)/i.test(text);
  const ic = /(hands-on building|own features end-to-end|i'?m most energized when)/i.test(text);
  if (em && !ic) return 'em';
  if (ic && !em) return 'ic';
  return 'both';
}

/** Tag vocabulary reuses the scraper's filter axes rather than inventing a parallel one. */
const TAG_RULES: Array<[string, RegExp]> = [
  ['react', /\breact\b/i], ['typescript', /typescript/i], ['node', /\bnode(js)?\b/i],
  ['graphql', /graphql/i], ['redux', /redux/i], ['python', /\bpython\b/i],
  ['ml', /(machine learning|pytorch|scikit|transformers|embeddings)/i],
  ['llm', /(llm|rag|claude api|ollama|quantization)/i],
  ['web3', /(blockchain|web3|tezos|nft|solidity|smart contract|crypto)/i],
  ['privacy', /(encrypt|e2e|end-to-end|privacy|mls)/i],
  ['chemistry', /(pharmaceutical|chemistry|peptide|gmp)/i],
  ['leadership', /(managed a team|mentoring|hiring|engineering manager)/i],
  ['teaching', /(bootcamp|ironhack|taught|instructor|meditation)/i],
];

function extractTags(text: string): string[] {
  return TAG_RULES.filter(([, re]) => re.test(text)).map(([tag]) => tag);
}

function splitParagraphs(raw: string): string[] {
  return raw
    .split(/\n\s*\n/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 0);
}

function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.split(' ').length > 3);
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const confirm = args.includes('--confirm');

  if (!dryRun && !confirm) {
    console.error('Specify --dry-run or --confirm');
    process.exit(1);
  }

  const manifestPath = path.join(CORPUS, 'MANIFEST.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`No manifest at ${manifestPath}`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { letters: ManifestEntry[] };

  let paragraphs = 0;
  let sentences = 0;
  let skipped = 0;
  const bySlot: Record<string, number> = {};

  for (const entry of manifest.letters) {
    const file = path.join(CORPUS, entry.file);
    if (!fs.existsSync(file)) {
      console.warn(`  missing: ${entry.file}`);
      skipped++;
      continue;
    }

    const raw = fs.readFileSync(file, 'utf8');
    const paras = splitParagraphs(raw);

    for (const [idx, para] of paras.entries()) {
      const slot = classifySlot(para, idx, paras.length);
      bySlot[slot] = (bySlot[slot] || 0) + 1;

      const base = {
        slot,
        provenance: entry.provenance,
        sourceLetter: path.basename(entry.file, '.txt'),
        sourceDate: entry.date,
        roleTrack: inferRoleTrack(para),
        tags: extractTags(para),
        voiceEligible: entry.voice_eligible === true,
      };

      if (confirm) {
        const parentId = insertChunk({ ...base, level: 'paragraph', content: para });
        // Sentences are the substitution unit; they keep a link to their parent
        // so a swapped sentence never lands in a paragraph it didn't come from.
        for (const s of splitSentences(para)) {
          insertChunk({ ...base, level: 'sentence', parentId, content: s });
          sentences++;
        }
      } else {
        sentences += splitSentences(para).length;
      }
      paragraphs++;
    }
  }

  console.log(`\nLetters:    ${manifest.letters.length - skipped} ingested, ${skipped} missing`);
  console.log(`Paragraphs: ${paragraphs}`);
  console.log(`Sentences:  ${sentences}`);
  console.log(`\nBy slot:`);
  for (const [slot, n] of Object.entries(bySlot).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${slot.padEnd(20)} ${n}`);
  }

  if (dryRun) {
    console.log('\nDRY RUN: nothing written. Re-run with --confirm.\n');
    return;
  }

  console.log('\nStored. Voice-eligible breakdown:');
  for (const row of chunkStats()) {
    console.log(`  ${row.provenance.padEnd(12)} ${row.slot.padEnd(20)} ${row.count}`);
  }
  console.log();
}

main();
