export type JobSource =
  | 'indeed'
  | 'remoteok'
  | 'linkedin'
  | 'arbeitnow'
  | 'adzuna'
  | 'hn-whoishiring'
  | 'jsearch'
  | '80000hours'
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
  score?: number; // For ranking/boosting
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
  includeTech: RegExp[];
  includeCompanyTypes: RegExp[];
  includeLocations: RegExp[];
  excludeTitles: RegExp[];
  boostKeywords: RegExp[];
}

export interface FilterResult {
  passed: boolean;
  score: number;
  matchedCriteria: string[];
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
