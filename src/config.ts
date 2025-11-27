import { config } from 'dotenv';
import { z } from 'zod';
import type { FilterConfig } from './types.js';

config({ quiet: true });

const envSchema = z.object({
  // Required
  ANTHROPIC_API_KEY: z.string().min(1),
  GOOGLE_SHEETS_ID: z.string().min(1),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email(),
  GOOGLE_PRIVATE_KEY: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),

  // Optional - additional job sources
  ADZUNA_APP_ID: z.string().optional(),
  ADZUNA_APP_KEY: z.string().optional(),
  RAPIDAPI_KEY: z.string().optional(), // For JSearch
  APIFY_TOKEN: z.string().optional(), // For LinkedIn scraping

  DRY_RUN: z.string().optional().transform(val => val === 'true'),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Missing or invalid environment variables:');
    console.error(result.error.message);
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();

export const filterConfig: FilterConfig = {
  includeTitles: [
    // Core dev roles
    /frontend/i,
    /front-end/i,
    /front end/i,
    /full.?stack/i,
    /react/i,
    /web developer/i,
    /software engineer/i,
    /software developer/i,
    // Management
    /engineering manager/i,
    /eng\.?\s*manager/i,
    /\bem\b/i,
    /tech lead/i,
    /team lead/i,
    // Adjacent roles (user requested)
    /product manager/i,
    /technical product manager/i,
    /\btpm\b/i,
    /developer relations/i,
    /developer advocate/i,
    /dev rel/i,
    /devrel/i,
    /developer evangelist/i,
    /technical writer/i,
    /solutions engineer/i,
    /solutions architect/i,
    /sales engineer/i,
  ],
  includeTech: [
    /react/i,
    /typescript/i,
    /vue/i,
    /javascript/i,
    // Blockchain/Web3
    /blockchain/i,
    /web3/i,
    /crypto(?!graphy)/i, // crypto but not cryptography alone
    /defi/i,
    /\bnft\b/i,
    /smart contract/i,
    /solidity/i,
    /ethereum/i,
    /tezos/i,
  ],
  includeCompanyTypes: [
    // Encrypted messaging / privacy
    /encrypt/i,
    /\be2e\b/i,
    /end-to-end/i,
    /privacy/i,
    /secure messaging/i,
    /\bsignal\b/i,
    /\bwire\b/i,
    /\belement\b/i,
    /\bmatrix\b/i,
  ],
  includeLocations: [
    // EU cities
    /berlin/i,
    /amsterdam/i,
    /lisbon/i,
    /dublin/i,
    /barcelona/i,
    /stockholm/i,
    /vienna/i,
    /munich/i,
    /copenhagen/i,
    /london/i,
    /paris/i,
    /zurich/i,
    // EU countries
    /\beu\b/i,
    /europe/i,
    /germany/i,
    /netherlands/i,
    /spain/i,
    /portugal/i,
    /ireland/i,
    /\buk\b/i,
    /united kingdom/i,
    /switzerland/i,
    /austria/i,
    /france/i,
    // Remote - general
    /remote/i,
    /distributed/i,
    // Worldwide/Global
    /worldwide/i,
    /global/i,
    /anywhere/i,
    /international/i,
    // US (remote ok, US-only requirements filtered separately)
    /\bus\b/i,
    /\busa\b/i,
    /united states/i,
  ],
  excludeTitles: [
    // Too senior
    /\bstaff\b/i,
    /principal/i,
    // Too junior
    /\bintern\b/i,
    /\binternship\b/i,
    /\bjunior\b/i,
    /\bjr\.?\b/i, // Jr. or Jr
    /\bgraduate\b/i,
    /\bentry[- ]level\b/i,
    /\bstudent\b/i,
    /werkstudent/i, // German for working student
    /\btrainee\b/i,
    /\bapprentice\b/i,
    /\bsoftware architect\b/i,
    /\bsystem architect\b/i,
    /\benterprise architect\b/i,
    /10\+?\s*years/i,
    /data engineer/i,
    /\bdevops\b/i,
    /\bsre\b/i,
    /\bmobile\b(?!.*react native)/i,
    /\bios\b/i,
    /\bandroid\b/i,
    /machine learning/i,
    /\bml\b/i,
    /data scientist/i,
    // Non-engineering roles
    /\bsales\b/i,
    /\bmarketing\b/i,
    /\bmarketer\b/i,
    /\brecruiter\b/i,
    /talent acquisition/i,
    /\bhr\b/i,
    /human resources/i,
    /customer success/i,
    /customer education/i,
    /account manager/i,
    /account executive/i,
    /business development/i,
    /\bbdr\b/i,
    /\bsdr\b/i,
    /operations manager/i,
    /compliance manager/i,
    /co-?founder/i,
    /\bceo\b/i,
    /\bcto\b/i,
    /\bcfo\b/i,
    /head of (?!engineer)/i,
    // Design/Product (non-engineering)
    /product designer/i,
    /\bux\b.*designer/i,
    /\bui\b.*designer/i,
    /graphic designer/i,
    // Other non-dev roles
    /data analyst/i,
    /business analyst/i,
    /spokesperson/i,
    /community manager/i,
    /community host/i,
    /content writer/i,
    /content strategist/i,
    /copywriter/i,
  ],
  boostKeywords: [
    /visa sponsorship/i,
    /relocation/i,
    /senior/i,
    // Boost for domain expertise
    /blockchain/i,
    /web3/i,
    /encrypt/i,
    /privacy/i,
    /e2e/i,
  ],
};

// Job source URLs
export const jobSources = {
  // Indeed RSS feeds seem to be deprecated/returning 404s
  // Keeping structure for future alternative RSS sources
  indeedRSS: [] as string[],
  remoteOK: 'https://remoteok.com/api',
};
