'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

type AISuggestion = 'STRONG_FIT' | 'GOOD_FIT' | 'MAYBE' | 'AUTO_DISMISS';

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
  aiReviewed?: boolean;
  aiSuggestion?: AISuggestion;
  aiReasoning?: string;
}

type SortOption = 'ai' | 'score' | 'date' | 'company';

const AI_SUGGESTION_ORDER: Record<AISuggestion, number> = {
  STRONG_FIT: 0,
  GOOD_FIT: 1,
  MAYBE: 2,
  AUTO_DISMISS: 3,
};

export default function CandidatesPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number; pending: number; job?: string }>({ completed: 0, total: 0, pending: 0 });
  const [sortBy, setSortBy] = useState<SortOption>('ai');
  const [reviewing, setReviewing] = useState(false);
  const [reviewProgress, setReviewProgress] = useState<{ total: number; completed: number; currentJob: string }>({ total: 0, completed: 0, currentJob: '' });
  const [reviewSummary, setReviewSummary] = useState<{ strongFit: number; goodFit: number; maybe: number; autoDismiss: number } | null>(null);

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

  // Check if AI review is running on page load
  const checkAIReviewStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs/ai-review');
      const status = await res.json();

      if (status.isRunning) {
        setReviewing(true);
        setReviewProgress({
          total: status.total,
          completed: status.completed,
          currentJob: status.currentJob || '',
        });

        // Start polling
        const pollInterval = setInterval(async () => {
          const statusRes = await fetch('/api/jobs/ai-review');
          const newStatus = await statusRes.json();
          setReviewProgress({
            total: newStatus.total,
            completed: newStatus.completed,
            currentJob: newStatus.currentJob || '',
          });
          if (!newStatus.isRunning) {
            clearInterval(pollInterval);
            setReviewing(false);
            if (newStatus.summary) {
              setReviewSummary(newStatus.summary);
            }
            fetchCandidates();
          }
        }, 1500);
      }
    } catch (err) {
      console.error('Failed to check AI review status:', err);
    }
  }, [fetchCandidates]);

  useEffect(() => {
    fetchCandidates();
    checkBatchStatus();
    checkAIReviewStatus();
  }, [fetchCandidates, checkBatchStatus, checkAIReviewStatus]);

  // Sort jobs based on selected option
  const sortedJobs = [...jobs].sort((a, b) => {
    switch (sortBy) {
      case 'ai':
        // Sort by AI suggestion first (Strong > Good > Maybe > Auto-dismiss > Not reviewed)
        // Then by score within each category
        const aOrder = a.aiSuggestion ? AI_SUGGESTION_ORDER[a.aiSuggestion] : 99;
        const bOrder = b.aiSuggestion ? AI_SUGGESTION_ORDER[b.aiSuggestion] : 99;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return b.score - a.score;
      case 'score':
        return b.score - a.score;
      case 'date':
        return new Date(b.dateFound).getTime() - new Date(a.dateFound).getTime();
      case 'company':
        return a.company.localeCompare(b.company);
      default:
        return 0;
    }
  });

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

  const handleRunAIReview = async () => {
    setReviewing(true);
    setReviewProgress({ total: jobs.length, completed: 0, currentJob: '' });

    try {
      const response = await fetch('/api/jobs/ai-review', { method: 'POST' });
      const data = await response.json();

      if (!response.ok) {
        alert(data.error || 'Failed to start AI review');
        setReviewing(false);
        return;
      }

      // All jobs already reviewed
      if (data.alreadyReviewed !== undefined) {
        alert(`All ${data.alreadyReviewed} jobs have already been reviewed.`);
        setReviewing(false);
        return;
      }

      // Poll for progress
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch('/api/jobs/ai-review');
          const status = await statusRes.json();

          setReviewProgress({
            total: status.total,
            completed: status.completed,
            currentJob: status.currentJob || '',
          });

          if (!status.isRunning) {
            clearInterval(pollInterval);
            setReviewing(false);
            if (status.summary) {
              setReviewSummary(status.summary);
            }
            fetchCandidates();
          }
        } catch (err) {
          console.error('Failed to poll AI review status:', err);
        }
      }, 1500);
    } catch (err) {
      console.error('Failed to start AI review:', err);
      setReviewing(false);
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
              {/* AI Review progress */}
              {reviewing && (
                <div className="text-sm text-[var(--ink-muted)] flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></span>
                  AI Review {reviewProgress.completed}/{reviewProgress.total}
                  {reviewProgress.currentJob && <span className="text-xs truncate max-w-[150px]">({reviewProgress.currentJob})</span>}
                </div>
              )}
              {/* Cover letter generation progress */}
              {generating && (
                <div className="text-sm text-[var(--ink-muted)] flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin"></span>
                  Generating {progress.completed}/{progress.completed + progress.pending}
                  {progress.job && <span className="text-xs truncate max-w-[150px]">({progress.job})</span>}
                </div>
              )}
              {/* AI Review button - show when not generating and have jobs */}
              {!generating && !reviewing && jobs.length > 0 && (
                <button
                  onClick={handleRunAIReview}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-purple-600 hover:bg-purple-50 border border-purple-200 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  AI Review
                </button>
              )}
              {selected.size > 0 && (
                <>
                  <button
                    onClick={handleDismissSelected}
                    disabled={generating || reviewing}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                  >
                    Dismiss ({selected.size})
                  </button>
                  <button
                    onClick={handleGenerateLetters}
                    disabled={generating || reviewing}
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
            {/* Toolbar: Select All + Sort */}
            <div className="flex items-center justify-between gap-3 mb-4 pb-4 border-b border-[var(--border)]">
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

              {/* Sort selector */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--ink-muted)]">Sort by:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="text-sm bg-white border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)]"
                >
                  <option value="ai">AI Ranking</option>
                  <option value="score">Filter Score</option>
                  <option value="date">Date Found</option>
                  <option value="company">Company</option>
                </select>
              </div>
            </div>

            {/* Candidate List */}
            <div className="space-y-3">
              {sortedJobs.map(job => (
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

      {/* AI Review Summary Modal */}
      {reviewSummary && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-[var(--border)]">
              <h2 className="text-xl font-serif font-medium text-[var(--ink)] flex items-center gap-2">
                <svg className="w-6 h-6 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                AI Review Complete
              </h2>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-[var(--ink-muted)] mb-4">
                {reviewSummary.strongFit + reviewSummary.goodFit + reviewSummary.maybe + reviewSummary.autoDismiss} jobs reviewed
              </p>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm">
                    <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
                    Strong Fit
                  </span>
                  <span className="font-medium text-emerald-700">{reviewSummary.strongFit}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm">
                    <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                    Good Fit
                  </span>
                  <span className="font-medium text-blue-700">{reviewSummary.goodFit}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm">
                    <span className="w-3 h-3 rounded-full bg-gray-400"></span>
                    Maybe
                  </span>
                  <span className="font-medium text-gray-600">{reviewSummary.maybe}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm">
                    <span className="w-3 h-3 rounded-full bg-red-500"></span>
                    Auto-dismissed
                  </span>
                  <span className="font-medium text-red-600">{reviewSummary.autoDismiss}</span>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-[var(--cream-dark)]/50 border-t border-[var(--border)]">
              <button
                onClick={() => setReviewSummary(null)}
                className="w-full btn-accent px-4 py-2 rounded-lg text-sm font-medium"
              >
                View Results
              </button>
            </div>
          </div>
        </div>
      )}
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
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-serif font-medium text-[var(--ink)]">
                    {job.title}
                  </h2>
                  {job.aiReviewed && job.aiSuggestion && (
                    <AIBadge suggestion={job.aiSuggestion} reasoning={job.aiReasoning} />
                  )}
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

function AIBadge({ suggestion, reasoning }: { suggestion: AISuggestion; reasoning?: string }) {
  const [showTooltip, setShowTooltip] = useState(false);

  const config = {
    STRONG_FIT: {
      label: 'Strong Fit',
      bg: 'bg-emerald-100',
      text: 'text-emerald-700',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ),
    },
    GOOD_FIT: {
      label: 'Good Fit',
      bg: 'bg-blue-100',
      text: 'text-blue-700',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
        </svg>
      ),
    },
    MAYBE: {
      label: 'Maybe',
      bg: 'bg-gray-100',
      text: 'text-gray-600',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    AUTO_DISMISS: {
      label: 'Not Fit',
      bg: 'bg-red-100',
      text: 'text-red-600',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      ),
    },
  };

  const { label, bg, text, icon } = config[suggestion] || config.MAYBE;

  return (
    <div className="relative inline-block">
      <button
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${bg} ${text} cursor-help`}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={(e) => {
          e.stopPropagation();
          setShowTooltip(!showTooltip);
        }}
      >
        {icon}
        {label}
      </button>
      {showTooltip && reasoning && (
        <div className="absolute z-50 bottom-full left-0 mb-2 w-64 p-3 bg-white rounded-lg shadow-lg border border-[var(--border)] text-sm text-[var(--ink)] font-normal">
          <div className="flex items-center gap-1.5 mb-1.5 text-xs text-[var(--ink-muted)]">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            AI Analysis
          </div>
          {reasoning}
          <div className="absolute bottom-0 left-4 w-2 h-2 bg-white border-b border-r border-[var(--border)] transform translate-y-1/2 rotate-45"></div>
        </div>
      )}
    </div>
  );
}
