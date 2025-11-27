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
  coverLetter: string;
  status: string;
}

export default function Home() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [scraperRunning, setScraperRunning] = useState(false);
  const [scraperStatus, setScraperStatus] = useState<string>('');

  const fetchJobs = useCallback(() => {
    fetch('/api/jobs')
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

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Poll scraper status while running
  useEffect(() => {
    if (!scraperRunning) return;

    const interval = setInterval(async () => {
      const res = await fetch('/api/scraper/run');
      const data = await res.json();

      if (!data.isRunning) {
        setScraperRunning(false);
        setScraperStatus('Completed! Refreshing...');
        fetchJobs();
        setTimeout(() => setScraperStatus(''), 3000);
      } else if (data.recentOutput?.length > 0) {
        setScraperStatus(data.recentOutput[data.recentOutput.length - 1]);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [scraperRunning, fetchJobs]);

  const handleRunScraper = async () => {
    setScraperRunning(true);
    setScraperStatus('Starting scraper...');

    try {
      await fetch('/api/scraper/run', { method: 'POST' });
    } catch (err) {
      console.error(err);
      setScraperRunning(false);
      setScraperStatus('Failed to start scraper');
    }
  };

  const filteredJobs = jobs.filter(job => {
    // "All" excludes NOT_FIT and PENDING (PENDING jobs go to candidates page)
    if (filter === 'all') return job.status !== 'NOT_FIT' && job.status !== 'PENDING';
    if (filter === 'pending') return job.status === 'PENDING';
    if (filter === 'new') return job.status === 'NEW';
    if (filter === 'applied') return job.status === 'APPLIED';
    if (filter === 'interview') return job.status === 'INTERVIEW';
    if (filter === 'not-fit') return job.status === 'NOT_FIT';
    return true;
  });

  // Metrics
  const activeJobs = jobs.filter(j => j.status !== 'NOT_FIT' && j.status !== 'PENDING');
  const metrics = {
    active: activeJobs.length,
    pending: jobs.filter(j => j.status === 'PENDING').length,
    new: jobs.filter(j => j.status === 'NEW').length,
    applied: jobs.filter(j => j.status === 'APPLIED').length,
    interview: jobs.filter(j => j.status === 'INTERVIEW').length,
    notFit: jobs.filter(j => j.status === 'NOT_FIT').length,
    sources: [...new Set(jobs.map(j => j.source))].length,
  };

  const filters = [
    { key: 'all', label: 'All', count: metrics.active },
    { key: 'pending', label: 'Pending', count: metrics.pending },
    { key: 'new', label: 'Ready', count: metrics.new },
    { key: 'applied', label: 'Applied', count: metrics.applied },
    { key: 'interview', label: 'Interview', count: metrics.interview },
    { key: 'not-fit', label: 'Not Fit', count: metrics.notFit },
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-[var(--ink-muted)] font-serif italic">Loading your opportunities...</p>
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
              <h1 className="text-2xl font-serif font-medium text-[var(--ink)]">Job Finder</h1>
              <p className="text-sm text-[var(--ink-muted)]">Track applications, craft letters</p>
            </div>
            <div className="flex items-center gap-4">
              {scraperStatus && (
                <span className="text-xs text-[var(--ink-muted)] max-w-[200px] truncate">
                  {scraperStatus}
                </span>
              )}
              {metrics.pending > 0 && (
                <Link
                  href="/candidates"
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors flex items-center gap-2"
                >
                  <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></span>
                  {metrics.pending} Candidates
                </Link>
              )}
              <button
                onClick={handleRunScraper}
                disabled={scraperRunning}
                className="btn-accent px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
              >
                {scraperRunning ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    Running...
                  </>
                ) : (
                  'Run Scraper'
                )}
              </button>
              <span className="text-xs font-mono text-[var(--ink-muted)] bg-[var(--cream-dark)] px-3 py-1.5 rounded">
                {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
              <Link
                href="/settings"
                className="p-2 rounded-lg text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--cream-dark)] transition-colors"
                title="Settings"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Metrics Dashboard */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 stagger-children">
          <MetricCard
            label="Active Jobs"
            value={metrics.active}
            sublabel={`${metrics.sources} sources`}
            accent={false}
          />
          <MetricCard
            label="To Review"
            value={metrics.pending}
            sublabel="Awaiting selection"
            accent={metrics.pending > 0}
          />
          <MetricCard
            label="Ready"
            value={metrics.new}
            sublabel="With cover letters"
            accent={false}
          />
          <MetricCard
            label="Applied"
            value={metrics.applied}
            sublabel={metrics.interview > 0 ? `${metrics.interview} interviewing` : 'None yet'}
            accent={metrics.applied > 0}
          />
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-1 mb-6 p-1 bg-[var(--cream-dark)] rounded-lg w-fit">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                filter === f.key
                  ? 'bg-[var(--ink)] text-[var(--cream)] shadow-sm'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--cream)]'
              }`}
            >
              {f.label}
              <span className={`ml-1.5 text-xs ${filter === f.key ? 'text-[var(--cream)]/70' : 'text-[var(--ink-muted)]'}`}>
                {f.count}
              </span>
            </button>
          ))}
        </div>

        {/* Job List */}
        <div className="space-y-3 stagger-children">
          {filteredJobs.map(job => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>

        {filteredJobs.length === 0 && (
          <div className="text-center py-16">
            <p className="text-[var(--ink-muted)] font-serif italic text-lg">No jobs match this filter</p>
          </div>
        )}
      </main>
    </div>
  );
}

function MetricCard({ label, value, sublabel, accent }: { label: string; value: number; sublabel: string; accent: boolean }) {
  return (
    <div className={`p-5 rounded-xl border transition-all hover:shadow-md ${
      accent
        ? 'bg-[var(--accent)] text-[var(--cream)] border-[var(--accent)]'
        : 'bg-white border-[var(--border)]'
    }`}>
      <p className={`text-xs uppercase tracking-wider mb-1 ${accent ? 'text-[var(--cream)]/70' : 'text-[var(--ink-muted)]'}`}>
        {label}
      </p>
      <p className={`text-3xl font-serif font-medium ${accent ? 'text-[var(--cream)]' : 'text-[var(--ink)]'}`}>
        {value}
      </p>
      <p className={`text-xs mt-1 ${accent ? 'text-[var(--cream)]/70' : 'text-[var(--ink-muted)]'}`}>
        {sublabel}
      </p>
    </div>
  );
}

function JobCard({ job }: { job: Job }) {
  const statusStyles: Record<string, string> = {
    PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
    NEW: 'bg-blue-50 text-blue-700 border-blue-200',
    APPLIED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    REJECTED: 'bg-red-50 text-red-700 border-red-200',
    INTERVIEW: 'bg-purple-50 text-purple-700 border-purple-200',
    NOT_FIT: 'bg-gray-50 text-gray-600 border-gray-200',
  };

  return (
    <Link
      href={`/jobs/${job.id}`}
      className="group block bg-white rounded-xl p-5 border border-[var(--border)] hover:border-[var(--accent)] hover:shadow-lg transition-all"
    >
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-serif font-medium text-[var(--ink)] group-hover:text-[var(--accent)] transition-colors truncate">
            {job.title}
          </h2>
          <p className="text-[var(--ink-muted)] mt-0.5 flex items-center gap-2">
            <span className="font-medium text-[var(--ink-light)]">{job.company}</span>
            <span className="text-[var(--border)]">•</span>
            <span>{job.location}</span>
          </p>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${statusStyles[job.status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
              {job.status}
            </span>
            <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-[var(--cream-dark)] text-[var(--ink-muted)]">
              {job.source}
            </span>
            {job.coverLetter ? (
              <span className="px-2.5 py-1 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200">
                ✓ Letter Ready
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-full text-xs bg-amber-50 text-amber-700 border border-amber-200">
                Needs Letter
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <span className="text-xs text-[var(--ink-muted)]">
            {new Date(job.dateFound).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
          <span className="text-[var(--accent)] opacity-0 group-hover:opacity-100 transition-opacity text-sm">
            View →
          </span>
        </div>
      </div>
    </Link>
  );
}
