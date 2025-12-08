'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface TopJob {
  id: string;
  title: string;
  company: string;
  location: string;
  aiSuggestion: string;
  aiReasoning: string;
}

interface SummaryData {
  newJobsCount: number;
  newJobsSince: string;
  summary: string;
  strongFitCount: number;
  goodFitCount: number;
  topJobs: TopJob[];
}

const LAST_VISITED_KEY = 'jobfinder_last_visited';

export function NewJobsSummary() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const fetchSummary = async () => {
      // Get last visited timestamp from localStorage
      const lastVisited = localStorage.getItem(LAST_VISITED_KEY);

      // If never visited, set current time and skip summary
      if (!lastVisited) {
        localStorage.setItem(LAST_VISITED_KEY, new Date().toISOString());
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/jobs/summary?since=${encodeURIComponent(lastVisited)}`);
        if (!res.ok) throw new Error('Failed to fetch summary');

        const summaryData = await res.json();
        setData(summaryData);
      } catch (err) {
        console.error('Error fetching summary:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    // Update last visited time
    localStorage.setItem(LAST_VISITED_KEY, new Date().toISOString());
  };

  const getSuggestionBadge = (suggestion: string) => {
    if (suggestion === 'STRONG_FIT') {
      return <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">Strong Fit</span>;
    }
    if (suggestion === 'GOOD_FIT') {
      return <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded">Good Fit</span>;
    }
    return null;
  };

  // Don't show if loading, dismissed, no data, or no new jobs
  if (loading || dismissed || !data || data.newJobsCount === 0) {
    return null;
  }

  // Only show if there are matches worth highlighting
  if (data.strongFitCount === 0 && data.goodFitCount === 0) {
    return null;
  }

  return (
    <div className="mb-6 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl overflow-hidden">
      {/* Collapsed Header */}
      <div
        className="px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-amber-100/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <p className="font-medium text-[var(--ink)]">
              {data.newJobsCount} new job{data.newJobsCount === 1 ? '' : 's'} since your last visit
            </p>
            <p className="text-sm text-[var(--ink-muted)]">
              {data.strongFitCount > 0 && (
                <span className="text-green-600 font-medium">{data.strongFitCount} strong fit{data.strongFitCount === 1 ? '' : 's'}</span>
              )}
              {data.strongFitCount > 0 && data.goodFitCount > 0 && ' + '}
              {data.goodFitCount > 0 && (
                <span className="text-blue-600 font-medium">{data.goodFitCount} good fit{data.goodFitCount === 1 ? '' : 's'}</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDismiss();
            }}
            className="px-3 py-1.5 text-sm text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
          >
            Dismiss
          </button>
          <svg
            className={`w-5 h-5 text-[var(--ink-muted)] transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-amber-200/50">
          {/* Summary */}
          <p className="text-sm text-[var(--ink-muted)] mt-4 mb-4 italic font-serif">
            {data.summary}
          </p>

          {/* Top Jobs */}
          {data.topJobs.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-[var(--ink-muted)] uppercase tracking-wide">Top Matches</p>
              {data.topJobs.map((job) => (
                <Link
                  key={job.id}
                  href={`/jobs/${job.id}`}
                  className="block p-3 bg-white/70 rounded-lg border border-amber-100 hover:border-amber-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-[var(--ink)] truncate">{job.title}</p>
                        {getSuggestionBadge(job.aiSuggestion)}
                      </div>
                      <p className="text-sm text-[var(--ink-muted)]">
                        {job.company} · {job.location}
                      </p>
                      {job.aiReasoning && (
                        <p className="text-xs text-[var(--ink-muted)] mt-1.5 line-clamp-2 italic">
                          {job.aiReasoning}
                        </p>
                      )}
                    </div>
                    <svg className="w-4 h-4 text-[var(--ink-muted)] flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* View All Button */}
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleDismiss}
              className="px-4 py-2 text-sm font-medium text-amber-700 hover:text-amber-800 transition-colors"
            >
              Got it, show me all jobs
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
