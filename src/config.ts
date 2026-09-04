import { config } from 'dotenv';
import { z } from 'zod';
import type { FilterConfig } from './types.js';

config({ quiet: true });

const envSchema = z.object({
  // Required
  ANTHROPIC_API_KEY: z.string().min(1),

  // Optional - Google Sheets (for syncing)
  GOOGLE_SHEETS_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),

  // Optional - Telegram notifications
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  // Optional - additional job sources
  ADZUNA_APP_ID: z.string().optional(),
  ADZUNA_APP_KEY: z.string().optional(),
  RAPIDAPI_KEY: z.string().optional(), // For JSearch

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
    // Data science / AI
    /data scientist/i,
    /data science/i,
    /machine learning engineer/i,
    /\bml engineer/i,
    /\bai engineer/i,
    /\bai\/ml\b/i,
    /applied scientist/i,
    /research engineer/i,
    /data engineer/i,
    /analytics engineer/i,
    /data analyst/i,
    /\bllm engineer/i,
    // AI safety / research roles (Anthropic Fellows, METR, FAR AI et al.)
    /research scientist/i,
    /member of technical staff/i,
    /alignment (engineer|scientist|research)/i,
    /\bevals? engineer/i,
    /red team/i,
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
  // Tech is grouped into categories so scoring counts distinct *signals* rather
  // than raw keyword hits. Matching react + typescript + redux is one signal
  // ("modern frontend"), not three, and grouping stops verbose job descriptions
  // outscoring terse ones for the same role.
  //
  // Categories double as the UI filter vocabulary - one list, not two.
  techCategories: {
    // Pivot target: applied AI / ML engineering (per job-overview.md positioning)
    ml: [
      /pytorch/i, /tensorflow/i, /scikit-?learn/i, /\bkeras\b/i,
      /machine learning/i, /deep learning/i, /neural network/i,
      /\bcnn\b/i, /transformers?\b/i, /model training/i, /fine-?tun/i,
      /quantization/i, /\bgpu\b/i, /\bmlops\b/i,
    ],
    llm: [
      /\bllm/i, /large language model/i, /\brag\b/i, /retrieval.augmented/i,
      /langchain/i, /hugging ?face/i, /\bollama\b/i, /prompt engineering/i,
      /embeddings?\b/i, /vector (search|database|store)/i, /\bchromadb\b/i,
      /\bevals?\b/i, /inference/i, /openai|anthropic|claude api/i,
    ],
    data: [
      /\bpandas\b/i, /\bnumpy\b/i, /\bsql\b/i, /\betl\b/i,
      /data pipeline/i, /\bairflow\b/i, /\bdbt\b/i, /recommendation system/i,
    ],
    frontend: [
      /\breact\b/i, /typescript/i, /javascript/i, /\bvue\b/i,
      /svelte(kit)?/i, /next\.?js/i, /\bredux\b/i, /\bastro\b/i, /electron/i,
    ],
    backend: [
      /node(\.?js)?\b/i, /nest(\.?js)?\b/i, /express/i, /fastapi/i,
      /graphql/i, /postgres(ql)?/i, /\bprisma\b/i, /supabase/i, /\bpython\b/i,
    ],
    infra: [
      /docker/i, /kubernetes/i, /\bci\/cd\b/i, /terraform/i, /\baws\b/i,
    ],
    web3: [
      /blockchain/i, /web3/i, /\bcrypto\b(?!graph)/i, /\bdefi\b/i, /\bnft\b/i,
      /smart contract/i, /solidity/i, /ethereum/i, /tezos/i,
    ],
    privacy: [
      // 'end-to-end' alone matches 'end-to-end ownership' in ~29% of job ads,
      // so it must be qualified by encryption to mean anything here.
      /encrypt/i, /\be2e\b/i, /end-to-end encrypt/i, /\bmls\b/i, /secure messaging/i,
    ],
  },

  includeCompanyTypes: [
    // Encrypted messaging / privacy
    /encrypt/i,
    /\be2e\b/i,
    /end-to-end encrypt/i,
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
    /italy/i,
    /milan/i,
    /belgium/i,
    /brussels/i,
    /madrid/i,
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
    // Too senior. Note "staff" must be qualified: "Member of Technical Staff" is
    // the standard IC title at Anthropic, OpenAI and Perplexity, and a bare
    // /\bstaff\b/ was excluding that entire category.
    /\bstaff (engineer|software engineer|developer|scientist)\b/i,
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
    /\bdevops\b/i,
    /\bsre\b/i,
    /\bmobile\b(?!.*react native)/i,
    /\bios\b/i,
    /\bandroid\b/i,
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
    // Data science / AI
    /machine learning/i,
    /deep learning/i,
    /data science/i,
    /\bllm/i,
    /pytorch/i,
    /tensorflow/i,
    // AI safety signals. Weighted because 7 of 12 roles on Tim's own shortlist
    // are AI-native companies, and his Fellows application is in this space.
    /ai safety/i,
    /alignment/i,
    /interpretability/i,
    /\bevals?\b/i,
    /red team/i,
    /frontier model/i,
  ],
};

// Flattened view of techCategories, for callers that just need "did any tech match".
export const allTechPatterns: RegExp[] = Object.values(filterConfig.techCategories).flat();

/** Which tech categories a job's text matches. Used for scoring and for UI filters. */
export function matchedTechCategories(text: string): string[] {
  return Object.entries(filterConfig.techCategories)
    .filter(([, patterns]) => patterns.some(p => p.test(text)))
    .map(([name]) => name);
}

// Job source URLs
export const jobSources = {
  // Indeed RSS feeds seem to be deprecated/returning 404s
  // Keeping structure for future alternative RSS sources
  indeedRSS: [] as string[],
  remoteOK: 'https://remoteok.com/api',
};
