'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';

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
  coverLetter: string;
  status: string;
  score?: number;
  aiReviewed?: boolean;
  aiSuggestion?: AISuggestion;
  aiReasoning?: string;
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
  const [showReviewProcess, setShowReviewProcess] = useState(false);
  const [activeTab, setActiveTab] = useState<'description' | 'letter'>('description');
  const [showNotFitModal, setShowNotFitModal] = useState(false);
  const [notFitReason, setNotFitReason] = useState<string>('other');
  const [blockValue, setBlockValue] = useState('');
  const [translating, setTranslating] = useState(false);
  const [translatedDescription, setTranslatedDescription] = useState<string | null>(null);

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [suggestedEdit, setSuggestedEdit] = useState<string | null>(null);
  const [lastChatLetter, setLastChatLetter] = useState<string>('');

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
      // Start background generation
      await fetch(`/api/jobs/${id}/regenerate`, { method: 'POST' });

      // Poll for completion
      const pollInterval = setInterval(async () => {
        try {
          const res = await fetch(`/api/jobs/${id}/regenerate`);
          const data = await res.json();

          if (data.status === 'done') {
            clearInterval(pollInterval);
            setRegenerateResult(data.result);
            setEditedLetter(data.result.final);
            setActiveTab('letter');
            setRegenerating(false);

            // Refresh job data to get updated cover letter
            const jobRes = await fetch(`/api/jobs/${id}`);
            const jobData = await jobRes.json();
            if (jobData.job) {
              setJob(jobData.job);
            }
          } else if (data.status === 'error') {
            clearInterval(pollInterval);
            console.error('Generation error:', data.error);
            setRegenerating(false);
          }
          // If still 'generating', keep polling
        } catch (err) {
          console.error('Polling error:', err);
          clearInterval(pollInterval);
          setRegenerating(false);
        }
      }, 1500); // Poll every 1.5 seconds

      // Safety timeout after 2 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        if (regenerating) {
          setRegenerating(false);
        }
      }, 120000);

    } catch (err) {
      console.error(err);
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

  const handleChatSend = async () => {
    if (!chatInput.trim() || chatLoading) return;

    const userMessage = chatInput.trim();
    setChatInput('');
    setChatLoading(true);
    setSuggestedEdit(null);

    // Check if letter changed since last chat message
    const letterChanged = lastChatLetter !== '' && editedLetter !== lastChatLetter;

    // Build messages array, injecting context if letter changed
    let updatedMessages = [...chatMessages];
    if (letterChanged) {
      // Calculate a brief summary of changes
      const oldWords = lastChatLetter.split(/\s+/).length;
      const newWords = editedLetter.split(/\s+/).length;
      const wordDiff = newWords - oldWords;
      const changeNote = wordDiff > 10 ? `(+${wordDiff} words)` :
                         wordDiff < -10 ? `(${wordDiff} words)` : '';

      updatedMessages.push({
        role: 'assistant',
        content: `[Letter was updated by user ${changeNote}]`
      });
    }

    // Add the user's new message
    updatedMessages.push({ role: 'user', content: userMessage });
    setChatMessages(updatedMessages);

    // Update the baseline for next comparison
    setLastChatLetter(editedLetter);

    try {
      const res = await fetch(`/api/jobs/${id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages,
          coverLetter: editedLetter,
        }),
      });

      const data = await res.json();
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);

      if (data.suggestedEdit) {
        setSuggestedEdit(data.suggestedEdit);
      }
    } catch (err) {
      console.error('Chat failed:', err);
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleApplySuggestion = () => {
    if (suggestedEdit) {
      setEditedLetter(suggestedEdit);
      setLastChatLetter(suggestedEdit); // Track as new baseline so we don't flag it as "changed"
      setSuggestedEdit(null);
      setChatMessages(prev => [...prev, { role: 'assistant', content: '✓ Changes applied to the letter above.' }]);
    }
  };

  // Strip markdown formatting for clean PDF/DOCX export
  const stripMarkdown = (text: string): string => {
    return text
      .replace(/\*\*([^*]+)\*\*/g, '$1')  // **bold** -> bold
      .replace(/\*([^*]+)\*/g, '$1')       // *italic* -> italic
      .replace(/__([^_]+)__/g, '$1')       // __bold__ -> bold
      .replace(/_([^_]+)_/g, '$1')         // _italic_ -> italic
      .replace(/^#{1,6}\s+/gm, '')         // # headers -> plain text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // [link](url) -> link
  };

  const downloadAsPDF = () => {
    if (!job || !editedLetter) return;

    const cleanLetter = stripMarkdown(editedLetter);
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const maxWidth = pageWidth - margin * 2;

    // Add title
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');

    // Split text into lines that fit the page width
    const lines = doc.splitTextToSize(cleanLetter, maxWidth);

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

    const cleanLetter = stripMarkdown(editedLetter);
    const paragraphs = cleanLetter.split('\n').map(line =>
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
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <h1 className="text-2xl font-serif font-medium text-[var(--ink)]">{job.title}</h1>
                {job.aiReviewed && job.aiSuggestion && (
                  <AIBadge suggestion={job.aiSuggestion} reasoning={job.aiReasoning} />
                )}
                {job.score !== undefined && job.score > 0 && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    job.score >= 30 ? 'bg-emerald-100 text-emerald-700' :
                    job.score >= 20 ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {job.score} pts
                  </span>
                )}
              </div>
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

              {/* AI Review Process (subtle disclosure) */}
              {regenerateResult && (
                <div className="mt-4 border-t border-[var(--border)] pt-4">
                  <button
                    onClick={() => setShowReviewProcess(!showReviewProcess)}
                    className="flex items-center gap-2 text-xs text-[var(--ink-muted)] hover:text-[var(--ink-light)] transition-colors"
                  >
                    <svg className={`w-3 h-3 transition-transform ${showReviewProcess ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    Show AI review process
                  </button>

                  {showReviewProcess && (
                    <div className="mt-3 space-y-3 animate-fade-in">
                      {/* Original Draft */}
                      <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                        <button
                          onClick={() => setShowDraft(!showDraft)}
                          className="flex items-center gap-2 text-xs text-gray-600 hover:text-gray-800 transition-colors w-full"
                        >
                          <svg className={`w-3 h-3 transition-transform ${showDraft ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          Original Draft (before review)
                        </button>
                        {showDraft && (
                          <div className="mt-2 p-3 bg-white rounded border border-gray-100 text-xs text-[var(--ink-muted)] max-h-48 overflow-auto">
                            <pre className="whitespace-pre-wrap font-sans">{regenerateResult.draft}</pre>
                          </div>
                        )}
                      </div>

                      {/* Reviewer Suggestions */}
                      <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                        <h4 className="text-xs font-medium text-gray-600 mb-2">Reviewer Suggestions</h4>
                        <div className="text-xs text-gray-600 space-y-1.5">
                          {regenerateResult.feedback.split('\n').filter(Boolean).map((line, i) => (
                            <p key={i}>{line}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Chat Interface */}
              <div className="mt-4 border-t border-[var(--border)] pt-4">
                <button
                  onClick={() => setChatOpen(!chatOpen)}
                  className="flex items-center gap-2 text-sm text-[var(--ink-muted)] hover:text-[var(--accent)] transition-colors"
                >
                  <svg className={`w-4 h-4 transition-transform ${chatOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Chat about this letter
                  {chatMessages.length > 0 && (
                    <span className="text-xs bg-[var(--accent)] text-white px-1.5 py-0.5 rounded-full">
                      {chatMessages.length}
                    </span>
                  )}
                </button>

                {chatOpen && (
                  <div className="mt-3 border border-[var(--border)] rounded-lg overflow-hidden animate-fade-in">
                    {/* Chat Messages */}
                    <div className="max-h-64 overflow-y-auto p-4 space-y-3 bg-[var(--cream-dark)]/30">
                      {chatMessages.length === 0 && (
                        <p className="text-sm text-[var(--ink-muted)] italic">
                          Ask questions or request changes to your cover letter...
                        </p>
                      )}
                      {chatMessages.map((msg, i) => (
                        <div
                          key={i}
                          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                              msg.role === 'user'
                                ? 'bg-[var(--accent)] text-white'
                                : 'bg-white border border-[var(--border)] text-[var(--ink)]'
                            }`}
                          >
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                          </div>
                        </div>
                      ))}
                      {chatLoading && (
                        <div className="flex justify-start">
                          <div className="bg-white border border-[var(--border)] px-3 py-2 rounded-lg">
                            <div className="flex gap-1">
                              <span className="w-2 h-2 bg-[var(--ink-muted)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                              <span className="w-2 h-2 bg-[var(--ink-muted)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                              <span className="w-2 h-2 bg-[var(--ink-muted)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Suggested Edit Banner */}
                    {suggestedEdit && (
                      <div className="px-4 py-2 bg-emerald-50 border-t border-emerald-200 flex items-center justify-between gap-3">
                        <span className="text-sm text-emerald-700">AI suggested changes to your letter</span>
                        <button
                          onClick={handleApplySuggestion}
                          className="px-3 py-1 bg-emerald-600 text-white text-xs font-medium rounded hover:bg-emerald-700 transition-colors"
                        >
                          Apply Changes
                        </button>
                      </div>
                    )}

                    {/* Chat Input */}
                    <div className="p-3 bg-white border-t border-[var(--border)] flex gap-2">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleChatSend()}
                        placeholder="e.g., Make it shorter, emphasize my React experience..."
                        className="flex-1 px-3 py-2 text-sm border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                        disabled={chatLoading}
                      />
                      <button
                        onClick={handleChatSend}
                        disabled={chatLoading || !chatInput.trim()}
                        className="px-4 py-2 bg-[var(--accent)] text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        Send
                      </button>
                    </div>
                  </div>
                )}
              </div>
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

function AIBadge({ suggestion, reasoning }: { suggestion: AISuggestion; reasoning?: string }) {
  const [showTooltip, setShowTooltip] = useState(false);

  const config = {
    STRONG_FIT: {
      label: 'Strong Fit',
      bg: 'bg-emerald-100',
      text: 'text-emerald-700',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ),
    },
    GOOD_FIT: {
      label: 'Good Fit',
      bg: 'bg-blue-100',
      text: 'text-blue-700',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
        </svg>
      ),
    },
    MAYBE: {
      label: 'Maybe',
      bg: 'bg-gray-100',
      text: 'text-gray-600',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    AUTO_DISMISS: {
      label: 'Not Fit',
      bg: 'bg-red-100',
      text: 'text-red-600',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      ),
    },
  };

  const { label, bg, text, icon } = config[suggestion] || config.MAYBE;

  return (
    <div className="relative inline-block">
      <button
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${bg} ${text} cursor-help`}
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
        <div className="absolute z-50 top-full left-0 mt-2 w-72 p-4 bg-white rounded-lg shadow-lg border border-[var(--border)] text-sm text-[var(--ink)] font-normal">
          <div className="flex items-center gap-1.5 mb-2 text-xs text-[var(--ink-muted)] font-medium">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            AI Analysis
          </div>
          {reasoning}
          <div className="absolute top-0 left-6 w-2 h-2 bg-white border-t border-l border-[var(--border)] transform -translate-y-1/2 rotate-45"></div>
        </div>
      )}
    </div>
  );
}
