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
    /\beval(s|uation|uations)? engineer/i,
    /\bevals?\b.*\bengineer/i,
    /red team/i,
    // Management
    /engineering manager/i,
    /eng\.?\s*manager/i,
    /\bem\b/i,
    /tech lead/i,
    /team lead/i,
    // Adjacent roles. Product and technical product management were here as an
    // explicit request and have been withdrawn: Tim's own labels weight
    // title_manager at -0.874, the strongest negative in the personalisation
    // layer, and product-management titles matched 4 of his labels with zero
    // yes. They were scoring +10 and passing the gate on the title alone.
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

  // Company identity, matched against the COMPANY FIELD ONLY - never the
  // description. Read from descriptions these were pure noise: /privacy/ hit
  // 765 jobs, 353 of them a "Candidate Privacy Notice" GDPR footer; /\be2e\b/
  // matched end-to-end *testing* in every sampled case; /signal/, /matrix/,
  // /element/ and /wire/ matched "demand signal", "approval matrix", "finite
  // element analysis" and "wire up integrations", with zero true positives
  // between them. Together they were worth +16, more than the Berlin bonus.
  includeCompanyTypes: [
    /\bproton\b/i,
    /\bsignal\b/i,
    /\bwire\b/i,
    /\belement\b/i,
    /\bmatrix\b/i,
    /tutanota/i,
    /mullvad/i,
    /\bduckduckgo\b/i,
  ],
  /**
   * Far from Berlin - flagged for relocation, NOT rejected.
   *
   * This began as an exclusion, on the reading that "Europe or the USA make the
   * most sense". It cost a STRONG_FIT at a Korean AI-safety lab, and Tim's
   * actual position is that he would move anywhere for the right role with
   * relocation support. So these now set requiresRelocation, which the
   * candidates page already has a toggle for, and he decides.
   *
   * Kept as a named list rather than inferred, because a job whose location is
   * simply unparseable should not be presented as an intercontinental move.
   */
  farLocations: [
    /\b(china|japan|korea|singapore|hong kong|taiwan|thailand|vietnam|malaysia|philippines|indonesia)\b/i,
    /\b(india|pakistan|bangladesh|sri lanka)\b/i,
    /\b(bengaluru|bangalore|mumbai|delhi|hyderabad|pune|chennai|noida|gurgaon|gurugram)\b/i,
    /\b(tokyo|osaka|seoul|shanghai|beijing|shenzhen|taipei|bangkok|jakarta|manila|ho chi minh)\b/i,
    /\b(dubai|abu dhabi|\buae\b|united arab emirates|qatar|doha|saudi|riyadh|israel|tel aviv)\b/i,
    /\b(australia|new zealand|sydney|melbourne|auckland)\b/i,
    /\b(brazil|argentina|chile|colombia|mexico|peru|s(a|ã)o paulo|buenos aires|bogot(a|á))\b/i,
    /\b(nigeria|kenya|egypt|south africa|lagos|nairobi|cairo|johannesburg|cape town)\b/i,
    /\b(canada|toronto|vancouver|montreal|ottawa)\b/i,
  ],

  // Target geography is Europe or the USA. The gate is deliberate - it keeps out
  // Beijing, Tel Aviv, Singapore - but the previous list only named a dozen
  // cities, so "San Francisco" with no country suffix failed to match and
  // Perplexity's entire Bay Area engineering org was being rejected.
  includeLocations: [
    // Germany
    /berlin/i, /munich|münchen/i, /hamburg/i, /frankfurt/i, /cologne|köln/i,
    /stuttgart/i, /d(ü|ue)sseldorf/i, /leipzig/i, /dresden/i, /n(ü|ue)rnberg|nuremberg/i,
    /jena/i, /karlsruhe/i, /germany|deutschland/i,
    // Rest of Europe - cities
    /amsterdam/i, /rotterdam/i, /utrecht/i, /eindhoven/i,
    /lisbon|lisboa/i, /porto/i, /madrid/i, /barcelona/i, /valencia/i,
    /paris/i, /lyon/i, /london/i, /manchester/i, /edinburgh/i, /cambridge/i, /oxford/i,
    /dublin/i, /stockholm/i, /copenhagen/i, /oslo/i, /helsinki/i,
    /vienna|wien/i, /zurich|z(ü|ue)rich/i, /geneva|gen(è|e)ve/i, /basel/i,
    /brussels|bruxelles/i, /luxembourg/i, /milan|milano/i, /rome|roma/i,
    /warsaw|warszawa/i, /krak(o|ó)w/i, /prague|praha/i, /budapest/i, /bucharest/i,
    /sofia/i, /belgrade/i, /zagreb/i, /ljubljana/i, /tallinn/i, /riga/i, /vilnius/i,
    /athens/i, /malta/i, /reykjav(i|í)k/i,
    // Europe - countries and regions
    /\beu\b/i, /europe/i, /\bemea\b/i,
    /netherlands/i, /spain/i, /portugal/i, /ireland/i, /\buk\b/i, /united kingdom/i,
    /switzerland/i, /austria/i, /france/i, /italy/i, /belgium/i, /poland/i,
    /czech/i, /denmark/i, /sweden/i, /norway/i, /finland/i, /estonia/i, /latvia/i,
    /lithuania/i, /greece/i, /romania/i, /bulgaria/i, /croatia/i, /slovenia/i, /serbia/i,
    // USA - cities and metros (Tim is a US citizen, no sponsorship needed)
    /san francisco|\bsf\b/i, /bay area/i, /palo alto/i, /mountain view/i, /berkeley/i,
    /new york|\bnyc\b/i, /brooklyn/i, /boston/i, /cambridge, ma/i, /seattle/i,
    /austin/i, /denver/i, /boulder/i, /chicago/i, /los angeles/i, /san diego/i,
    /portland/i, /atlanta/i, /miami/i, /washington, ?dc/i, /pittsburgh/i,
    // USA - country
    /\bus\b/i, /\busa\b/i, /united states/i, /u\.s\./i,
    // Remote / distributed
    /remote/i, /distributed/i, /worldwide/i, /global/i, /anywhere/i, /international/i,
  ],
  excludeTitles: [
    // Not engineering. Withdrawn from includeTitles on 2026-09-05: Tim does not
    // want them and considers them unlikely, and his labels agree.
    /product manager/i,
    /technical product manager/i,
    /\btpm\b/i,
    /product owner/i,
    /program(me)? manager/i,
    // Staff and Principal are NOT excluded. Sampling what these rules rejected,
    // /staff (engineer|...)/ threw away 33% good - including three Anthropic
    // Staff Software Engineer roles - and /principal/ threw away a Staff /
    // Principal Research Engineer in AI Safety. Tim was an Engineering Manager
    // at Wire with 6+ years, so staff-level IC is a legitimate target, and
    // Anthropic is a company he wants surfaced whether or not any given role is
    // a stretch. Aiming high is his call to make, not the filter's.
    //
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
    // Non-engineering roles at engineering companies. Every posting at an AI
    // company mentions Claude/LLM/ML in its boilerplate, so the lenient
    // "2+ tech categories" pass rule was admitting IT Support, AV Operations,
    // Data Center Architect and Research Counsel on the strength of the company
    // description rather than the role.
    /\bit support\b/i,
    /\bav\b (engineer|operations|specialist|technician)/i,
    /data cent(er|re)/i,
    /hardware (lab|engineer|technician)/i,
    /\bcounsel\b/i,
    /business systems/i,
    /enablement/i,
    /\bpolicy (design|manager|analyst)\b/i,
    /partner manager/i,
    /executive assistant/i,
    /\bfacilities\b/i,
    /workplace (experience|manager)/i,
    /technical writer, /i,
    /\brecruiting\b/i,
    /\bsourcer\b/i,
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

/**
 * Per-category score weights.
 *
 * Unweighted, every category was worth the same, so a Berlin CRUD job matching
 * frontend+backend+infra+data scored identically to an Anthropic RL role. The
 * stated target is applied AI / ML engineering, and the scorer should say so.
 */
export const CATEGORY_WEIGHTS: Record<string, number> = {
  ml: 14,
  llm: 14,
  data: 10,
  privacy: 8,
  web3: 6,
  frontend: 6,
  backend: 5,
  infra: 4,
};

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
