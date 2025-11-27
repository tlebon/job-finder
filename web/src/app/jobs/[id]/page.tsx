'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';

interface Job {
  id: string;
  dateFound: string;
  source: string;
  company: string;
  title: string;
  location: string;
  url: string;
  description: string;
  coverLetter: string;
  status: string;
}

interface RegenerateResult {
  draft: string;
  feedback: string;
  final: string;
}

export default function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editedLetter, setEditedLetter] = useState('');
  const [regenerateResult, setRegenerateResult] = useState<RegenerateResult | null>(null);
  const [showDraft, setShowDraft] = useState(false);
  const [activeTab, setActiveTab] = useState<'description' | 'letter'>('description');
  const [showNotFitModal, setShowNotFitModal] = useState(false);
  const [notFitReason, setNotFitReason] = useState<string>('other');
  const [blockValue, setBlockValue] = useState('');
  const [translating, setTranslating] = useState(false);
  const [translatedDescription, setTranslatedDescription] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/jobs/${id}`)
      .then(res => res.json())
      .then(data => {
        setJob(data.job);
        setEditedLetter(data.job?.coverLetter || '');
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [id]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    setRegenerateResult(null);

    try {
      const res = await fetch(`/api/jobs/${id}/regenerate`, { method: 'POST' });
      const data = await res.json();

      setRegenerateResult(data);
      setEditedLetter(data.final);
      setActiveTab('letter');
    } catch (err) {
      console.error(err);
    } finally {
      setRegenerating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      await fetch(`/api/jobs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coverLetter: editedLetter }),
      });

      if (job) {
        setJob({ ...job, coverLetter: editedLetter });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    // Show modal for NOT_FIT to ask for reason
    if (newStatus === 'NOT_FIT') {
      setShowNotFitModal(true);
      return;
    }

    try {
      await fetch(`/api/jobs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (job) {
        setJob({ ...job, status: newStatus });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleNotFitSubmit = async () => {
    try {
      await fetch(`/api/jobs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'NOT_FIT',
          notFitReason,
          blockValue: blockValue || undefined,
        }),
      });

      if (job) {
        setJob({ ...job, status: 'NOT_FIT' });
      }
      setShowNotFitModal(false);
      setNotFitReason('other');
      setBlockValue('');
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await fetch(`/api/jobs/${id}`, { method: 'DELETE' });
      router.push('/');
    } catch (err) {
      console.error(err);
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleTranslate = async () => {
    setTranslating(true);
    try {
      const res = await fetch(`/api/jobs/${id}/translate`, { method: 'POST' });
      const data = await res.json();
      if (data.translatedDescription) {
        setTranslatedDescription(data.translatedDescription);
      }
    } catch (err) {
      console.error('Translation failed:', err);
    } finally {
      setTranslating(false);
    }
  };

  const downloadAsPDF = () => {
    if (!job || !editedLetter) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const maxWidth = pageWidth - margin * 2;

    // Add title
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');

    // Split text into lines that fit the page width
    const lines = doc.splitTextToSize(editedLetter, maxWidth);

    let y = margin;
    const lineHeight = 6;

    for (const line of lines) {
      if (y > doc.internal.pageSize.getHeight() - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += lineHeight;
    }

    const filename = `Cover_Letter_${job.company.replace(/[^a-zA-Z0-9]/g, '_')}_${job.title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    doc.save(filename);
  };

  const downloadAsDocx = async () => {
    if (!job || !editedLetter) return;

    const paragraphs = editedLetter.split('\n').map(line =>
      new Paragraph({
        children: [new TextRun({ text: line, size: 24 })],
        spacing: { after: 200 },
      })
    );

    const doc = new Document({
      sections: [{
        properties: {},
        children: paragraphs,
      }],
    });

    const blob = await Packer.toBlob(doc);
    const filename = `Cover_Letter_${job.company.replace(/[^a-zA-Z0-9]/g, '_')}_${job.title.replace(/[^a-zA-Z0-9]/g, '_')}.docx`;
    saveAs(blob, filename);
  };

  // Detect if description appears to be non-English
  const looksNonEnglish = (text: string): boolean => {
    if (!text || text.length < 100) return false;

    // Common English words - if we find many of these, it's likely English
    const englishPatterns = /\b(the|and|you|your|will|with|for|are|this|that|have|from|our|work|team|experience|requirements|about|looking|join|company|role|position|skills|working|development|should|would|could|being|been|their|they|what|when|where|which|who|into|more|also|other|than|then|some|only|over|such|after|most|before|between|through|during|without|within|along|across|behind|beyond)\b/gi;
    const englishMatches = text.match(englishPatterns) || [];

    // Common non-English patterns (German, French, Spanish, Dutch, Portuguese)
    const nonEnglishPatterns = /\b(und|oder|wir|für|mit|bei|ist|sind|werden|haben|ihre|unser|arbeit|stelle|aufgaben|anforderungen|erfahrung|entwicklung|nous|vous|avec|pour|dans|notre|votre|être|avoir|travail|expérience|équipe|desarrollo|experiencia|trabajo|equipo|empresa|conocimientos|requisitos|wij|onze|ervaring|werken|zoeken|kandidaat|functie|zeer|também|nossa|você|trabalho|experiência|desenvolvimento|vagas)\b/gi;
    const nonEnglishMatches = text.match(nonEnglishPatterns) || [];

    // If non-English words outnumber English words significantly, it's likely non-English
    return nonEnglishMatches.length >= 5 && nonEnglishMatches.length > englishMatches.length * 0.3;
  };

  const statusStyles: Record<string, string> = {
    PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
    NEW: 'bg-blue-50 text-blue-700 border-blue-200',
    APPLIED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    REJECTED: 'bg-red-50 text-red-700 border-red-200',
    INTERVIEW: 'bg-purple-50 text-purple-700 border-purple-200',
    NOT_FIT: 'bg-gray-50 text-gray-600 border-gray-200',
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-[var(--ink-muted)] font-serif italic">Loading job details...</p>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--ink-muted)] font-serif italic">Job not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[var(--border)] bg-[var(--cream)]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="text-[var(--ink-muted)] hover:text-[var(--accent)] transition-colors text-sm"
            >
              ← Back
            </Link>
            <div className="h-4 w-px bg-[var(--border)]"></div>
            <span className="font-serif text-[var(--ink)]">{job.company}</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Job Header Card */}
        <div className="bg-white rounded-xl p-6 border border-[var(--border)] mb-6 animate-fade-in">
          <div className="flex justify-between items-start gap-6">
            <div className="flex-1">
              <h1 className="text-2xl font-serif font-medium text-[var(--ink)] mb-2">{job.title}</h1>
              <p className="text-[var(--ink-muted)] flex items-center gap-3">
                <span className="font-medium text-[var(--ink-light)]">{job.company}</span>
                <span className="text-[var(--border)]">•</span>
                <span>{job.location}</span>
                <span className="text-[var(--border)]">•</span>
                <span className="font-mono text-xs">{job.source}</span>
              </p>

              <div className="flex items-center gap-3 mt-4">
                <select
                  value={job.status}
                  onChange={e => handleStatusChange(e.target.value)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border cursor-pointer ${statusStyles[job.status] || 'bg-gray-50'}`}
                >
                  <option value="PENDING">PENDING</option>
                  <option value="NEW">NEW</option>
                  <option value="APPLIED">APPLIED</option>
                  <option value="INTERVIEW">INTERVIEW</option>
                  <option value="REJECTED">REJECTED</option>
                  <option value="NOT_FIT">NOT FIT</option>
                </select>

                <span className="text-xs text-[var(--ink-muted)]">
                  Found {new Date(job.dateFound).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary px-4 py-2 rounded-lg text-sm font-medium"
              >
                Apply on Site →
              </a>
              <button
                onClick={handleRegenerate}
                disabled={regenerating}
                className="btn-accent px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {regenerating ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    Generating...
                  </span>
                ) : (
                  'Generate Letter'
                )}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 border border-red-200 transition-colors"
              >
                Delete Job
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Tab Switcher */}
        <div className="lg:hidden flex gap-1 mb-4 p-1 bg-[var(--cream-dark)] rounded-lg">
          <button
            onClick={() => setActiveTab('description')}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === 'description'
                ? 'bg-white shadow-sm text-[var(--ink)]'
                : 'text-[var(--ink-muted)]'
            }`}
          >
            Description
          </button>
          <button
            onClick={() => setActiveTab('letter')}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === 'letter'
                ? 'bg-white shadow-sm text-[var(--ink)]'
                : 'text-[var(--ink-muted)]'
            }`}
          >
            Cover Letter
          </button>
        </div>

        {/* Two column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Job Description */}
          <div className={`bg-white rounded-xl border border-[var(--border)] overflow-hidden ${activeTab !== 'description' ? 'hidden lg:block' : ''}`}>
            <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--cream-dark)]/50 flex justify-between items-center">
              <h2 className="font-serif font-medium text-[var(--ink)]">Job Description</h2>
              {(looksNonEnglish(job.description) || translatedDescription) && (
                <div className="flex items-center gap-2">
                  {translatedDescription && (
                    <button
                      onClick={() => setTranslatedDescription(null)}
                      className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
                    >
                      Show Original
                    </button>
                  )}
                  {!translatedDescription && (
                    <button
                      onClick={handleTranslate}
                      disabled={translating}
                      className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-medium hover:bg-blue-100 transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      {translating ? (
                        <>
                          <span className="w-3 h-3 border-2 border-blue-700/30 border-t-blue-700 rounded-full animate-spin"></span>
                          Translating...
                        </>
                      ) : (
                        'Translate to English'
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="p-6 max-h-[70vh] overflow-auto">
              {translatedDescription ? (
                <div
                  className="job-description"
                  dangerouslySetInnerHTML={{ __html: translatedDescription }}
                />
              ) : (
                <div
                  className="job-description"
                  dangerouslySetInnerHTML={{ __html: job.description }}
                />
              )}
              {job.description && (job.description.length < 500 || job.description.trim().endsWith('…') || job.description.trim().endsWith('...')) && (
                <div className="mt-4 pt-4 border-t border-[var(--border)]">
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
          </div>

          {/* Cover Letter */}
          <div className={`bg-white rounded-xl border border-[var(--border)] overflow-hidden ${activeTab !== 'letter' ? 'hidden lg:block' : ''}`}>
            <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--cream-dark)]/50 flex justify-between items-center">
              <h2 className="font-serif font-medium text-[var(--ink)]">Cover Letter</h2>
              <div className="flex items-center gap-2">
                {editedLetter && (
                  <>
                    <button
                      onClick={downloadAsPDF}
                      className="px-3 py-1.5 bg-[var(--cream-dark)] text-[var(--ink-muted)] rounded-lg text-xs font-medium hover:bg-[var(--border)] transition-colors"
                    >
                      PDF
                    </button>
                    <button
                      onClick={downloadAsDocx}
                      className="px-3 py-1.5 bg-[var(--cream-dark)] text-[var(--ink-muted)] rounded-lg text-xs font-medium hover:bg-[var(--border)] transition-colors"
                    >
                      DOCX
                    </button>
                  </>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving || editedLetter === job.coverLetter}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : editedLetter !== job.coverLetter ? 'Save Changes' : 'Saved'}
                </button>
              </div>
            </div>

            <div className="p-6">
              {/* Show feedback if regenerated */}
              {regenerateResult && (
                <div className="mb-4 p-4 bg-amber-50 rounded-lg border border-amber-200 animate-fade-in">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-sm font-medium text-amber-800">AI Reviewer Feedback</h3>
                    <button
                      onClick={() => setShowDraft(!showDraft)}
                      className="text-xs text-amber-600 hover:text-amber-800 hover:underline"
                    >
                      {showDraft ? 'Hide Draft' : 'Show Original Draft'}
                    </button>
                  </div>
                  {showDraft && (
                    <div className="mb-3 p-3 bg-white rounded border border-amber-100 text-xs text-[var(--ink-muted)] max-h-48 overflow-auto">
                      <pre className="whitespace-pre-wrap font-sans">{regenerateResult.draft}</pre>
                    </div>
                  )}
                  <div className="text-sm text-amber-700 space-y-2">
                    {regenerateResult.feedback.split('\n').filter(Boolean).map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                  </div>
                </div>
              )}

              <textarea
                value={editedLetter}
                onChange={e => setEditedLetter(e.target.value)}
                placeholder="No cover letter yet. Click 'Generate Letter' above to create one."
                className="w-full h-[50vh] p-4 rounded-lg border border-[var(--border)] bg-[var(--cream-dark)]/30 text-[var(--ink)] text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent)] font-mono leading-relaxed"
              />

              {editedLetter && (
                <div className="mt-3 flex justify-between items-center text-xs text-[var(--ink-muted)]">
                  <span>{editedLetter.split(/\s+/).length} words</span>
                  <span className="font-mono">
                    {editedLetter.length} chars
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-white rounded-xl p-6 max-w-md mx-4 shadow-xl">
            <h3 className="font-serif text-lg font-medium text-[var(--ink)] mb-2">Delete this job?</h3>
            <p className="text-[var(--ink-muted)] text-sm mb-6">
              This will permanently remove "{job?.title}" at {job?.company} from your list.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--ink-muted)] hover:bg-[var(--cream-dark)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NOT_FIT Reason Modal */}
      {showNotFitModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-white rounded-xl p-6 max-w-md mx-4 shadow-xl">
            <h3 className="font-serif text-lg font-medium text-[var(--ink)] mb-2">Why doesn't this fit?</h3>
            <p className="text-[var(--ink-muted)] text-sm mb-4">
              Help improve future searches by telling us why.
            </p>

            <div className="space-y-3 mb-6">
              <label className="flex items-start gap-3 p-3 rounded-lg border border-[var(--border)] hover:bg-[var(--cream-dark)]/50 cursor-pointer transition-colors">
                <input
                  type="radio"
                  name="notFitReason"
                  value="company"
                  checked={notFitReason === 'company'}
                  onChange={() => { setNotFitReason('company'); setBlockValue(''); }}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-sm">Block company</div>
                  <div className="text-xs text-[var(--ink-muted)]">Block "{job?.company}" from future results</div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-lg border border-[var(--border)] hover:bg-[var(--cream-dark)]/50 cursor-pointer transition-colors">
                <input
                  type="radio"
                  name="notFitReason"
                  value="keyword"
                  checked={notFitReason === 'keyword'}
                  onChange={() => setNotFitReason('keyword')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm">Block keyword in title</div>
                  <div className="text-xs text-[var(--ink-muted)] mb-2">Block jobs with a specific word (e.g., "werkstudent", "intern")</div>
                  {notFitReason === 'keyword' && (
                    <input
                      type="text"
                      value={blockValue}
                      onChange={e => setBlockValue(e.target.value)}
                      placeholder="Enter keyword to block"
                      className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    />
                  )}
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-lg border border-[var(--border)] hover:bg-[var(--cream-dark)]/50 cursor-pointer transition-colors">
                <input
                  type="radio"
                  name="notFitReason"
                  value="other"
                  checked={notFitReason === 'other'}
                  onChange={() => { setNotFitReason('other'); setBlockValue(''); }}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-sm">Other / Skip</div>
                  <div className="text-xs text-[var(--ink-muted)]">Just mark as not a fit, don't block anything</div>
                </div>
              </label>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowNotFitModal(false); setNotFitReason('other'); setBlockValue(''); }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--ink-muted)] hover:bg-[var(--cream-dark)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleNotFitSubmit}
                disabled={notFitReason === 'keyword' && !blockValue}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--ink)] text-white hover:bg-[var(--ink-light)] transition-colors disabled:opacity-50"
              >
                Mark as Not Fit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
