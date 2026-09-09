/**
 * Structured features, ported from ml/features.py.
 *
 * TF-IDF can only say a term is present. It cannot compare 3 years against 10 -
 * both are the token "years" - and it cannot separate "fluent German required"
 * from "German is a plus", which is the difference between a job Tim can take
 * and one he cannot.
 *
 * This is a second implementation of an extractor that already exists in
 * Python, which is exactly the drift risk that kept these features out of the
 * shipped model. The answer is the mechanism the scorer already uses: the
 * exporter writes a fixture holding Python's own feature vectors for 200 real
 * postings, and features.test.ts asserts this file reproduces them. A
 * divergence fails a test instead of degrading production silently.
 *
 * Fidelity notes, where JavaScript and Python disagree by default:
 *
 *   - Python's \b is unicode-aware; JavaScript's is ASCII-only, so /\bremote\b/
 *     matches inside "remoteüber" in JS and not in Python. Every boundary here
 *     is written as an explicit \p{L}\p{N}_ lookaround instead.
 *   - len() counts code points, .length counts UTF-16 units. The one length
 *     feature spreads them with [...text].length.
 */

/** Python's unicode-aware \b(...)\b, which /\b/ in JavaScript is not. */
function bounded(alternation: string, flags = 'iu'): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternation})(?![\\p{L}\\p{N}_])`, flags);
}

// From the stored profile. Grouped, because a posting matching three ML terms
// is a different signal from one matching three frontend terms.
const STACKS: Record<string, string[]> = {
  ml: ['pytorch', 'tensorflow', 'scikit-learn', 'sklearn', 'pandas', 'numpy', 'hugging face',
    'huggingface', 'transformers', 'embeddings', 'sentence-transformers', 'rag',
    'fine-tun', 'quantiz', 'llm', 'machine learning', 'deep learning', 'mlops'],
  frontend: ['react', 'typescript', 'javascript', 'next.js', 'nextjs', 'sveltekit', 'svelte',
    'redux', 'electron', 'css', 'tailwind', 'vue'],
  backend: ['node.js', 'nodejs', 'fastapi', 'nestjs', 'express', 'graphql', 'postgres',
    'postgresql', 'prisma', 'supabase', 'python', 'rest api'],
  infra: ['docker', 'ci/cd', 'aws', 'kubernetes', 'terraform', 'gcp'],
};

/** Things Tim does not have, so a hard requirement is a real cost. */
const FOREIGN_STACK = ['java', '.net', 'c#', 'php', 'ruby on rails', 'golang', 'scala', 'kotlin',
  'salesforce', 'sap', 'abap', 'drupal', 'wordpress', 'sharepoint'];

const DOMAINS: Record<string, string[]> = {
  ai_safety: ['ai safety', 'alignment', 'interpretability', 'red team', 'frontier model',
    'responsible ai', 'ai policy', 'evals', 'model evaluation'],
  privacy: ['end-to-end encrypt', 'e2ee', 'zero-knowledge', 'privacy-preserving',
    'secure messaging', 'open source', 'self-hosted', 'gdpr-first'],
  science: ['biotech', 'bioinformatics', 'genomic', 'protein', 'drug discovery',
    'pharmaceutical', 'clinical', 'chemistry', 'laboratory', 'molecul'],
  adtech_gambling: ['adtech', 'ad tech', 'programmatic advertis', 'gambling', 'casino',
    'betting', 'igaming', 'affiliate marketing'],
  defence: ['defense contractor', 'defence', 'military', 'weapons', 'surveillance'],
  fintech: ['fintech', 'payments', 'banking', 'insurance', 'trading', 'wealth'],
  ecommerce: ['e-commerce', 'ecommerce', 'retail', 'marketplace', 'logistics'],
};

const AGENCY = ['recruitment', 'recruiting agency', 'staffing', 'headhunt', 'personalberatung',
  'our client', 'unser kunde', 'on behalf of our client', 'consultancy',
  'interim', 'contract role', 'umbrella', 'ir35'];
const AI_LAB = ['anthropic', 'openai', 'deepmind', 'mistral', 'cohere', 'perplexity',
  'elevenlabs', 'hugging face', 'scale ai', 'together ai', 'fireworks'];

/** Distance as tiers: Berlin is home, Europe is a move within the same rules. */
const LOCATION_TIERS: [string, RegExp][] = [
  ['berlin', bounded('berlin')],
  ['germany', bounded('germany|deutschland|munich|münchen|hamburg|frankfurt|cologne|köln|stuttgart|leipzig')],
  ['europe', bounded('netherlands|amsterdam|france|paris|spain|madrid|barcelona|portugal|lisbon|'
    + 'ireland|dublin|sweden|stockholm|denmark|copenhagen|norway|oslo|finland|helsinki|'
    + 'switzerland|zurich|zürich|austria|vienna|poland|warsaw|czech|prague|belgium|brussels|italy|milan')],
  ['uk', bounded('united kingdom|england|london|manchester|edinburgh|cambridge|oxford|bristol')],
  ['usa', bounded('united states|usa|california|new york|san francisco|seattle|boston|austin|texas|remote \\(us\\)')],
];

const YEARS = /(\d{1,2})\s*\+?\s*(?:years|yrs|jahre|jahren|ans|anni)/gi;
const GERMAN_REQUIRED = new RegExp(
  '(fluent|native|verhandlungssicher|sehr gute|fliessend|fließend|c1|c2)[^.]{0,40}(german|deutsch)'
  + '|(german|deutsch)[^.]{0,40}(required|erforderlich|mandatory|voraussetzung|must)', 'i');
const GERMAN_NICE = /(german|deutsch)[^.]{0,30}(a plus|nice to have|von vorteil|beneficial|advantage)/i;
const PHD = bounded('ph\\.?d|doctorate|promotion abgeschlossen');
const CLEARANCE = /(security clearance|sicherheitsüberprüfung|citizenship required)/i;
const EQUITY = bounded('equity|stock options|rsus?');
const REMOTE = bounded('remote|home office|hybrid');
const TITLE_JUNIOR = bounded('junior|graduate|intern|working student|werkstudent');
const TITLE_SENIOR = bounded('senior|sr\\.?|lead|principal|staff');
const TITLE_MANAGER = bounded('manager|head of|director|vp');

/** Python's `sum(1 for t in terms if t in low)` - distinct terms present. */
function hits(low: string, terms: string[]): number {
  let n = 0;
  for (const t of terms) if (low.includes(t)) n++;
  return n;
}

export function extract(title: string, text: string, location = ''): Record<string, number> {
  const blob = `${title}\n${text}`;
  const low = blob.toLowerCase();

  // The largest stated figure is the binding requirement; postings often list a
  // small number for a nice-to-have and a large one for the core ask.
  const years = [...blob.matchAll(YEARS)].map(m => parseInt(m[1], 10));
  const maxYears = years.length ? Math.max(...years) : 0;

  const f: Record<string, number> = {
    years_required: Math.min(maxYears, 20),
    years_over_6: Math.max(0, Math.min(maxYears, 20) - 6),
    german_required: GERMAN_REQUIRED.test(blob) ? 1 : 0,
    german_nice: GERMAN_NICE.test(blob) ? 1 : 0,
    phd: PHD.test(blob) ? 1 : 0,
    clearance: CLEARANCE.test(blob) ? 1 : 0,
    equity: EQUITY.test(blob) ? 1 : 0,
    posting_is_german:
      hits(low, [' und ', ' oder ', ' wir ', ' sie ', 'aufgaben', 'kenntnisse']) >= 2 ? 1 : 0,
    remote: REMOTE.test(low) ? 1 : 0,
    // Code points, matching Python's len(), not UTF-16 units.
    length: Math.min([...text].length, 20000) / 1000,
  };

  for (const [name, terms] of Object.entries(STACKS)) f[`stack_${name}`] = hits(low, terms);
  f.stack_foreign = hits(low, FOREIGN_STACK);

  // Relational: how much of the posting's stack Tim actually has.
  const own = Object.keys(STACKS).reduce((sum, n) => sum + f[`stack_${n}`], 0);
  f.stack_fit = own / (own + f.stack_foreign + 1);

  for (const [name, terms] of Object.entries(DOMAINS)) f[`domain_${name}`] = hits(low, terms);

  f.agency_posting = hits(low, AGENCY) ? 1 : 0;
  f.known_ai_lab = hits(low, AI_LAB) ? 1 : 0;

  const loc = `${(location || '').toLowerCase()} ${low.slice(0, 600)}`;
  for (const [name, pattern] of LOCATION_TIERS) f[`loc_${name}`] = pattern.test(loc) ? 1 : 0;
  f.loc_unknown = LOCATION_TIERS.some(([n]) => f[`loc_${n}`]) ? 0 : 1;

  // Level, from the title only - the body says "senior" about the team.
  const t = title.toLowerCase();
  f.title_junior = TITLE_JUNIOR.test(t) ? 1 : 0;
  f.title_senior = TITLE_SENIOR.test(t) ? 1 : 0;
  f.title_manager = TITLE_MANAGER.test(t) ? 1 : 0;

  return f;
}
