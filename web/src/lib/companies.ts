/**
 * One definition of a company slug, shared by the API routes that group by it
 * and the UI that links to it. Two copies drifting apart would show an
 * "applied here" badge pointing at a 404.
 */
export const slugifyCompany = (name: string): string =>
  (name || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
