'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Job {
  id: string;
  dateFound: string;
  source: string;
  company: string;
  title: string;
  location: string;
  url: string;
  description: string;
  status: string;
  score: number;
}

export default function CandidatesPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number; pending: number; job?: string }>({ completed: 0, total: 0, pending: 0 });

  const fetchCandidates = useCallback(() => {
    setLoading(true);
    fetch('/api/jobs?status=PENDING')
      .then(res => res.json())
      .then(data => {
        setJobs(data.jobs || []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  // Check if batch generation is already running on page load, and resume if there are pending jobs
  const checkBatchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs/generate-batch');
      const status = await res.json();

      // If there are pending jobs but not running, resume processing
      if (status.pending > 0 && !status.isRunning) {
        await fetch('/api/jobs/generate-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resume: true }),
        });
      }

      if (status.isRunning || status.pending > 0) {
        setGenerating(true);
        setProgress({
          completed: status.completed,
          total: status.total,
          pending: status.pending,
          job: status.currentJob,
        });
        // Start polling
        const pollInterval = setInterval(async () => {
          const statusRes = await fetch('/api/jobs/generate-batch');
          const newStatus = await statusRes.json();
          setProgress({
            completed: newStatus.completed,
            total: newStatus.total,
            pending: newStatus.pending,
            job: newStatus.currentJob,
          });
          if (!newStatus.isRunning && newStatus.pending === 0) {
            clearInterval(pollInterval);
            setGenerating(false);
            fetchCandidates();
          }
        }, 1500);
      }
    } catch (err) {
      console.error('Failed to check batch status:', err);
    }
  }, [fetchCandidates]);

  useEffect(() => {
    fetchCandidates();
    checkBatchStatus();
  }, [fetchCandidates, checkBatchStatus]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === jobs.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(jobs.map(j => j.id)));
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleGenerateLetters = async () => {
    if (selected.size === 0) return;

    setGenerating(true);
    setProgress({ completed: 0, total: selected.size, pending: selected.size });

    try {
      // Start the background job
      const response = await fetch('/api/jobs/generate-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: Array.from(selected) }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start generation');
      }

      // Poll for progress
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch('/api/jobs/generate-batch');
          const status = await statusRes.json();

          setProgress({
            completed: status.completed,
            total: status.total,
            pending: status.pending,
            job: status.currentJob,
          });

          if (!status.isRunning && status.pending === 0) {
            clearInterval(pollInterval);
            setGenerating(false);
            setSelected(new Set());
            fetchCandidates();
          }
        } catch (err) {
          console.error('Failed to poll status:', err);
        }
      }, 1500);
    } catch (err) {
      console.error('Failed to generate letters:', err);
      setGenerating(false);
    }
  };

  const handleDismiss = async (id: string) => {
    try {
      await fetch(`/api/jobs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'NOT_FIT' }),
      });
      setJobs(prev => prev.filter(j => j.id !== id));
      setSelected(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      console.error('Failed to dismiss job:', err);
    }
  };

  const handleDismissSelected = async () => {
    if (selected.size === 0) return;

    for (const id of selected) {
      await handleDismiss(id);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-[var(--ink-muted)] font-serif italic">Loading candidates...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[var(--border)] bg-[var(--cream)]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div>
              <div className="flex items-center gap-3">
                <Link href="/" className="text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </Link>
                <h1 className="text-2xl font-serif font-medium text-[var(--ink)]">Review Candidates</h1>
              </div>
              <p className="text-sm text-[var(--ink-muted)] ml-8">
                {jobs.length} pending • {selected.size} selected
              </p>
            </div>
            <div className="flex items-center gap-3">
              {generating && (
                <div className="text-sm text-[var(--ink-muted)] flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin"></span>
                  Generating {progress.completed}/{progress.completed + progress.pending}
                  {progress.job && <span className="text-xs truncate max-w-[150px]">({progress.job})</span>}
                </div>
              )}
              {selected.size > 0 && (
                <>
                  <button
                    onClick={handleDismissSelected}
                    disabled={generating}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                  >
                    Dismiss ({selected.size})
                  </button>
                  <button
                    onClick={handleGenerateLetters}
                    disabled={generating}
                    className="btn-accent px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                  >
                    {generating ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        Generating...
                      </>
                    ) : (
                      `Generate Letters (${selected.size})`
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {jobs.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[var(--ink-muted)] font-serif italic text-lg mb-4">No candidates to review</p>
            <p className="text-sm text-[var(--ink-muted)]">
              Run the scraper to find new job opportunities
            </p>
            <Link href="/" className="inline-block mt-4 text-[var(--accent)] hover:underline">
              Go to Dashboard
            </Link>
          </div>
        ) : (
          <>
            {/* Select All */}
            <div className="flex items-center gap-3 mb-4 pb-4 border-b border-[var(--border)]">
              <button
                onClick={toggleAll}
                className="flex items-center gap-2 text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                <span className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                  selected.size === jobs.length
                    ? 'bg-[var(--accent)] border-[var(--accent)]'
                    : 'border-[var(--border)]'
                }`}>
                  {selected.size === jobs.length && (
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
                {selected.size === jobs.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            {/* Candidate List */}
            <div className="space-y-3">
              {jobs.map(job => (
                <CandidateCard
                  key={job.id}
                  job={job}
                  selected={selected.has(job.id)}
                  expanded={expanded.has(job.id)}
                  onToggle={() => toggleSelect(job.id)}
                  onExpand={() => toggleExpand(job.id)}
                  onDismiss={() => handleDismiss(job.id)}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function CandidateCard({
  job,
  selected,
  expanded,
  onToggle,
  onExpand,
  onDismiss,
}: {
  job: Job;
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onDismiss: () => void;
}) {
  const [showDismissConfirm, setShowDismissConfirm] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translatedDescription, setTranslatedDescription] = useState<string | null>(null);

  const handleTranslate = async () => {
    setTranslating(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}/translate`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setTranslatedDescription(data.translatedDescription);
      }
    } catch (err) {
      console.error('Failed to translate:', err);
    } finally {
      setTranslating(false);
    }
  };

  // Simple heuristic to detect if text is likely non-English
  const isLikelyNonEnglish = (text: string): boolean => {
    if (!text) return false;
    const plainText = text.replace(/<[^>]*>/g, '').toLowerCase();
    // Common English words - if text has very few of these, probably not English
    const englishMarkers = /\b(the|and|or|is|are|we|you|our|for|with|this|that|have|will|from|about|your)\b/g;
    const matches = plainText.match(englishMarkers) || [];
    // If less than 2% of words are common English words, likely non-English
    const wordCount = plainText.split(/\s+/).length;
    return wordCount > 20 && (matches.length / wordCount) < 0.02;
  };

  const showTranslateButton = isLikelyNonEnglish(job.description);
  const displayDescription = translatedDescription || job.description;

  return (
    <div className={`bg-white rounded-xl border transition-all ${
      selected ? 'border-[var(--accent)] shadow-md' : 'border-[var(--border)]'
    }`}>
      {/* Main card content - clickable to expand */}
      <div
        className="p-5 cursor-pointer"
        onClick={(e) => {
          // Don't expand if clicking on interactive elements
          if ((e.target as HTMLElement).closest('button, a, input')) return;
          onExpand();
        }}
      >
        <div className="flex items-start gap-4">
          {/* Checkbox */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 cursor-pointer ${
              selected
                ? 'bg-[var(--accent)] border-[var(--accent)]'
                : 'border-[var(--border)] hover:border-[var(--accent)]'
            }`}
          >
            {selected && (
              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>

          {/* Job Info */}
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-serif font-medium text-[var(--ink)]">
                    {job.title}
                  </h2>
                  {job.score > 0 && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      job.score >= 30 ? 'bg-emerald-100 text-emerald-700' :
                      job.score >= 20 ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {job.score} pts
                    </span>
                  )}
                </div>
                <p className="text-[var(--ink-muted)] mt-0.5 flex items-center gap-2">
                  <span className="font-medium text-[var(--ink-light)]">{job.company}</span>
                  <span className="text-[var(--border)]">•</span>
                  <span>{job.location}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-[var(--cream-dark)] text-[var(--ink-muted)]">
                  {job.source}
                </span>
                <span className="text-xs text-[var(--ink-muted)]">
                  {new Date(job.dateFound).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </div>
            </div>

            {/* Description preview (collapsed) */}
            {!expanded && (
              <p className="text-sm text-[var(--ink-muted)] mt-3 line-clamp-2">
                {displayDescription?.replace(/<[^>]*>/g, '').substring(0, 300)}
              </p>
            )}

            {/* Actions */}
            <div className="flex items-center gap-4 mt-4">
              <span className="text-sm text-[var(--accent)] flex items-center gap-1">
                {expanded ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                    Click to collapse
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    Click to expand
                  </>
                )}
              </span>
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]"
                onClick={(e) => e.stopPropagation()}
              >
                Original Listing
              </a>
              <Link
                href={`/jobs/${job.id}`}
                className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]"
                onClick={(e) => e.stopPropagation()}
              >
                Full Page
              </Link>
              {showDismissConfirm ? (
                <div className="flex items-center gap-2 ml-auto" onClick={(e) => e.stopPropagation()}>
                  <span className="text-xs text-[var(--ink-muted)]">Dismiss?</span>
                  <button
                    onClick={() => {
                      onDismiss();
                      setShowDismissConfirm(false);
                    }}
                    className="text-sm text-red-600 hover:text-red-700 font-medium cursor-pointer"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setShowDismissConfirm(false)}
                    className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDismissConfirm(true);
                  }}
                  className="text-sm text-red-500 hover:text-red-700 ml-auto cursor-pointer"
                >
                  Not a Fit
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Expanded description */}
      {expanded && (
        <div className="border-t border-[var(--border)] px-5 py-4 bg-[var(--cream-dark)]/30">
          {/* Translate button - only show for non-English content */}
          {(showTranslateButton || translatedDescription) && (
            <div className="flex items-center gap-3 mb-3">
              {translatedDescription ? (
                <span className="text-xs text-emerald-600 flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Translated to English
                </span>
              ) : (
                <button
                  onClick={handleTranslate}
                  disabled={translating}
                  className="text-xs text-[var(--ink-muted)] hover:text-[var(--accent)] flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                >
                  {translating ? (
                    <>
                      <span className="w-3 h-3 border border-[var(--accent)] border-t-transparent rounded-full animate-spin"></span>
                      Translating...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                      </svg>
                      Translate to English
                    </>
                  )}
                </button>
              )}
              {translatedDescription && (
                <button
                  onClick={() => setTranslatedDescription(null)}
                  className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer"
                >
                  Show original
                </button>
              )}
            </div>
          )}

          <div
            className="job-description text-sm max-h-[400px] overflow-auto"
            dangerouslySetInnerHTML={{ __html: displayDescription }}
          />
          {job.description && (job.description.length < 500 || job.description.trim().endsWith('…') || job.description.trim().endsWith('...')) && (
            <div className="mt-4 pt-3 border-t border-[var(--border)]">
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--accent)] hover:underline"
              >
                View full listing on original site
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
