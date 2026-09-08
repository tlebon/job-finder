'use client';

import { useEffect, useState } from 'react';
import { slugifyCompany } from './companies';

/** Slugs of companies with at least one application already sent. */
export function useAppliedCompanies(): Set<string> {
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

  return applied;
}

export { slugifyCompany };
