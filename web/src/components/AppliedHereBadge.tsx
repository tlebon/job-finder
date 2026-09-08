'use client';

import Link from 'next/link';
import { slugifyCompany } from '@/lib/useAppliedCompanies';

/**
 * Marks a posting at a company Tim has already applied to.
 *
 * It reports rather than hides. Several teams at a large company hire
 * separately and a second application is normal; at a company of twelve one
 * person reads all of them and it is not. The badge links to the company page
 * so that call can be made with the other roles in view.
 */
export function AppliedHereBadge({ company, applied }: { company: string; applied: Set<string> }) {
  const slug = slugifyCompany(company);
  if (!applied.has(slug)) return null;

  return (
    <Link
      href={`/companies/${slug}`}
      title="You have already applied at this company — see what else is open"
      className="px-2 py-0.5 rounded-full text-xs font-medium border bg-[var(--success-light)] text-[var(--success)] border-[var(--success)]/30 hover:underline"
    >
      applied here
    </Link>
  );
}
