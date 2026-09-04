export type JobSource =
  | 'indeed'
  | 'remoteok'
  | 'linkedin'
  | 'arbeitnow'
  | 'adzuna'
  | 'hn-whoishiring'
  | 'jsearch'
  | '80000hours'
  | 'ats'
  | 'apify'
  | 'other';

export interface Job {
  id: string;
  dateFound: string;
  source: JobSource;
  company: string;
  title: string;
  location: string;
  url: string;
  description: string;
  coverLetter?: string;
  status: 'PENDING' | 'NEW' | 'APPROVED' | 'APPLIED' | 'INTERVIEW' | 'REJECTED' | 'NOT_FIT';
  notes?: string;
  appliedDate?: string;
  score?: number;
  /** Tech categories matched at filter time. */
  categories?: string[];
  requiresRelocation?: boolean; // For ranking/boosting
  /** The trained model's probability, stored so the UI can sort on it. */
  modelScore?: number;
}

export interface RawJob {
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  source: JobSource;
}

export interface FilterConfig {
  includeTitles: RegExp[];
  techCategories: Record<string, RegExp[]>;
  includeCompanyTypes: RegExp[];
  includeLocations: RegExp[];
  farLocations: RegExp[];
  excludeTitles: RegExp[];
  boostKeywords: RegExp[];
}

/**
 * How far a reach a job is, kept separate from how much Tim wants it.
 *
 * Collapsing the two is what made a single verdict uninformative: a moonshot
 * and a poor match both came out MAYBE, and nothing downstream could tell them
 * apart. Held separately, a dream role at a famous lab can be STRONG_FIT and
 * moonshot at once - which is the useful thing to know, and lets him spend a
 * fixed appetite for long shots deliberately rather than by accident.
 */
export type Reach = 'realistic' | 'stretch' | 'moonshot';

export interface FilterResult {
  passed: boolean;
  score: number;
  /** Probability the trained model gives this posting. See src/model/score.ts. */
  modelScore?: number;
  matchedCriteria: string[];
  /** Distinct tech categories matched. Doubles as the UI filter vocabulary. */
  categories: string[];
  /** US on-site with no remote option: reachable, but implies a move. */
  requiresRelocation?: boolean;
}

export interface CoverLetterContext {
  jobTitle: string;
  company: string;
  location: string;
  jobDescription: string;
  isWeb3Role: boolean;
  isPrivacyRole: boolean;
  isEMRole: boolean;
}
