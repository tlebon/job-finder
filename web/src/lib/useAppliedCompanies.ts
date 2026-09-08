'use client';

import { useCallback, useEffect, useState } from 'react';
import { slugifyCompany } from './companies';

/**
 * Slugs of companies with at least one application already sent.
 *
 * `noteApplied` records one locally so the other roles at that company are
 * marked immediately, without a second round trip. The server is the authority;
 * this only closes the gap until the next load.
 */
export function useAppliedCompanies(): {
  applied: Set<string>;
  noteApplied: (company: string) => void;
} {
  const [applied, setApplied] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch('/api/companies');
        const data = await res.json();
        if (!live) return;
        setApplied(new Set(
          (data.companies ?? [])
            .filter((c: { applied: number }) => c.applied > 0)
            .map((c: { slug: string }) => c.slug),
        ));
      } catch {
        // A missing badge is a smaller problem than a broken candidates page.
      }
    })();
    return () => { live = false; };
  }, []);

  const noteApplied = useCallback((company: string) => {
    setApplied(prev => new Set(prev).add(slugifyCompany(company)));
  }, []);

  return { applied, noteApplied };
}

export { slugifyCompany };
