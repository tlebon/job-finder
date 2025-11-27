'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

interface Profile {
  name: string;
  title: string;
  location: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  website: string;
  summary: string;
  experience: string;
  skills: string;
  preferences: string;
}

interface FilterRule {
  id: string;
  type: string;
  pattern: string;
  weight: number;
  enabled: boolean;
}

interface BlocklistEntry {
  id: string;
  type: string;
  value: string;
  reason?: string;
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'profile' | 'filters' | 'blocklist'>('profile');
  const [profile, setProfile] = useState<Profile>({
    name: '', title: '', location: '', email: '', phone: '',
    linkedin: '', github: '', website: '', summary: '',
    experience: '', skills: '', preferences: '',
  });
  const [rules, setRules] = useState<FilterRule[]>([]);
  const [blocklist, setBlocklist] = useState<BlocklistEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newRule, setNewRule] = useState({ type: 'include_title', pattern: '', weight: 10 });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Fetch profile
    fetch('/api/profile')
      .then(res => res.json())
      .then(data => {
        if (data.profile) setProfile(data.profile);
      });

    // Fetch filters and blocklist
    fetch('/api/filters')
      .then(res => res.json())
      .then(data => {
        setRules(data.rules || []);
        setBlocklist(data.blocklist || []);
      });
  }, []);

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save profile:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleResumeUpload = async (file: File) => {
    setUploading(true);
    setUploadError('');

    try {
      const formData = new FormData();
      formData.append('resume', file);

      const res = await fetch('/api/profile/parse-resume', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to parse resume');
      }

      const { profile: parsedProfile } = await res.json();

      // Merge with existing profile (keep existing values if parsed is empty)
      setProfile(prev => ({
        name: parsedProfile.name || prev.name,
        title: parsedProfile.title || prev.title,
        location: parsedProfile.location || prev.location,
        email: parsedProfile.email || prev.email,
        phone: parsedProfile.phone || prev.phone,
        linkedin: parsedProfile.linkedin || prev.linkedin,
        github: parsedProfile.github || prev.github,
        website: parsedProfile.website || prev.website,
        summary: parsedProfile.summary || prev.summary,
        experience: parsedProfile.experience || prev.experience,
        skills: parsedProfile.skills || prev.skills,
        preferences: parsedProfile.preferences || prev.preferences,
      }));
    } catch (err) {
      console.error('Failed to upload resume:', err);
      setUploadError(err instanceof Error ? err.message : 'Failed to parse resume');
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleResumeUpload(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleResumeUpload(file);
  };

  const handleAddRule = async () => {
    if (!newRule.pattern.trim()) return;

    try {
      const res = await fetch('/api/filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRule),
      });
      const data = await res.json();
      setRules(data.rules || []);
      setNewRule({ type: 'include_title', pattern: '', weight: 10 });
    } catch (err) {
      console.error('Failed to add rule:', err);
    }
  };

  const handleToggleRule = async (id: string, enabled: boolean) => {
    try {
      const res = await fetch('/api/filters', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled }),
      });
      const data = await res.json();
      setRules(data.rules || []);
    } catch (err) {
      console.error('Failed to toggle rule:', err);
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      const res = await fetch(`/api/filters?id=${id}&type=rule`, { method: 'DELETE' });
      const data = await res.json();
      setRules(data.rules || []);
    } catch (err) {
      console.error('Failed to delete rule:', err);
    }
  };

  const handleDeleteBlocklist = async (id: string) => {
    try {
      const res = await fetch(`/api/filters?id=${id}&type=blocklist`, { method: 'DELETE' });
      const data = await res.json();
      setBlocklist(data.blocklist || []);
    } catch (err) {
      console.error('Failed to delete blocklist entry:', err);
    }
  };

  const ruleTypes = [
    { value: 'include_title', label: 'Include Title', description: 'Job titles to match' },
    { value: 'exclude_title', label: 'Exclude Title', description: 'Job titles to reject' },
    { value: 'include_tech', label: 'Tech Stack', description: 'Technologies to look for' },
    { value: 'include_location', label: 'Location', description: 'Locations to include' },
    { value: 'include_company_type', label: 'Company Type', description: 'Company keywords (e.g., blockchain)' },
    { value: 'boost', label: 'Boost Keywords', description: 'Keywords that increase score' },
  ];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[var(--border)] bg-[var(--cream)]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-[var(--ink-muted)] hover:text-[var(--accent)] transition-colors text-sm">
              ← Back
            </Link>
            <div className="h-4 w-px bg-[var(--border)]"></div>
            <h1 className="text-xl font-serif font-medium text-[var(--ink)]">Settings</h1>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 p-1 bg-[var(--cream-dark)] rounded-lg w-fit">
          {[
            { key: 'profile', label: 'Profile' },
            { key: 'filters', label: 'Filter Rules' },
            { key: 'blocklist', label: 'Blocklist' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? 'bg-[var(--ink)] text-[var(--cream)] shadow-sm'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--cream)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <div className="space-y-6">
            {/* Resume Upload */}
            <div
              className={`bg-white rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                uploading ? 'border-[var(--accent)] bg-[var(--cream-dark)]/30' : 'border-[var(--border)] hover:border-[var(--accent)]'
              }`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt"
                onChange={handleFileSelect}
                className="hidden"
              />
              {uploading ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-sm text-[var(--ink-muted)]">Parsing resume with AI...</p>
                </div>
              ) : (
                <>
                  <svg className="w-10 h-10 mx-auto text-[var(--ink-muted)] mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-sm text-[var(--ink)] font-medium mb-1">Upload your resume</p>
                  <p className="text-xs text-[var(--ink-muted)] mb-3">Drag & drop a PDF or TXT file, or click to browse</p>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 text-sm font-medium text-[var(--accent)] border border-[var(--accent)] rounded-lg hover:bg-[var(--accent)] hover:text-white transition-colors"
                  >
                    Choose File
                  </button>
                </>
              )}
              {uploadError && (
                <p className="text-sm text-red-600 mt-3">{uploadError}</p>
              )}
            </div>

            {/* Profile Form */}
            <div className="bg-white rounded-xl border border-[var(--border)] p-6">
              <h2 className="text-lg font-serif font-medium text-[var(--ink)] mb-4">Your Profile</h2>
              <p className="text-sm text-[var(--ink-muted)] mb-6">
                This information is used to personalize your cover letters.
              </p>

              <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--ink)] mb-1">Name</label>
                  <input
                    type="text"
                    value={profile.name}
                    onChange={e => setProfile({ ...profile, name: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ink)] mb-1">Title</label>
                  <input
                    type="text"
                    value={profile.title}
                    onChange={e => setProfile({ ...profile, title: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder="Frontend Developer"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--ink)] mb-1">Location</label>
                  <input
                    type="text"
                    value={profile.location}
                    onChange={e => setProfile({ ...profile, location: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder="Berlin, Germany"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ink)] mb-1">Email</label>
                  <input
                    type="email"
                    value={profile.email}
                    onChange={e => setProfile({ ...profile, email: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder="john@example.com"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--ink)] mb-1">LinkedIn</label>
                  <input
                    type="text"
                    value={profile.linkedin}
                    onChange={e => setProfile({ ...profile, linkedin: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder="linkedin.com/in/..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ink)] mb-1">GitHub</label>
                  <input
                    type="text"
                    value={profile.github}
                    onChange={e => setProfile({ ...profile, github: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder="github.com/..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ink)] mb-1">Website</label>
                  <input
                    type="text"
                    value={profile.website}
                    onChange={e => setProfile({ ...profile, website: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder="yoursite.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ink)] mb-1">Professional Summary</label>
                <textarea
                  value={profile.summary}
                  onChange={e => setProfile({ ...profile, summary: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  placeholder="Brief summary of your background and what you're looking for..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ink)] mb-1">Experience Highlights</label>
                <textarea
                  value={profile.experience}
                  onChange={e => setProfile({ ...profile, experience: e.target.value })}
                  rows={4}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  placeholder="Key achievements and experience to highlight in cover letters..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ink)] mb-1">Skills</label>
                <textarea
                  value={profile.skills}
                  onChange={e => setProfile({ ...profile, skills: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  placeholder="React, TypeScript, Node.js, ..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ink)] mb-1">Job Preferences</label>
                <textarea
                  value={profile.preferences}
                  onChange={e => setProfile({ ...profile, preferences: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  placeholder="Remote work, specific industries, company size preferences..."
                />
              </div>

              <div className="flex justify-end pt-4">
                <button
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="btn-accent px-6 py-2 rounded-lg font-medium disabled:opacity-50"
                >
                  {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Profile'}
                </button>
              </div>
              </div>
            </div>
          </div>
        )}

        {/* Filters Tab */}
        {activeTab === 'filters' && (
          <div className="space-y-6">
            {/* Add new rule */}
            <div className="bg-white rounded-xl border border-[var(--border)] p-6">
              <h2 className="text-lg font-serif font-medium text-[var(--ink)] mb-4">Add Filter Rule</h2>
              <p className="text-sm text-[var(--ink-muted)] mb-4">
                Filter rules determine which jobs pass through the scraper. Patterns are regex-enabled.
              </p>

              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-[var(--ink)] mb-1">Type</label>
                  <select
                    value={newRule.type}
                    onChange={e => setNewRule({ ...newRule, type: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    {ruleTypes.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-[2]">
                  <label className="block text-sm font-medium text-[var(--ink)] mb-1">Pattern</label>
                  <input
                    type="text"
                    value={newRule.pattern}
                    onChange={e => setNewRule({ ...newRule, pattern: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder="e.g., frontend|react|vue"
                  />
                </div>
                <div className="w-24">
                  <label className="block text-sm font-medium text-[var(--ink)] mb-1">Weight</label>
                  <input
                    type="number"
                    value={newRule.weight}
                    onChange={e => setNewRule({ ...newRule, weight: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>
                <button
                  onClick={handleAddRule}
                  className="btn-accent px-4 py-2 rounded-lg font-medium"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Existing rules */}
            <div className="bg-white rounded-xl border border-[var(--border)] p-6">
              <h2 className="text-lg font-serif font-medium text-[var(--ink)] mb-4">
                Filter Rules ({rules.length})
              </h2>

              {rules.length === 0 ? (
                <p className="text-sm text-[var(--ink-muted)] italic">
                  No filter rules yet. Add some above or they will be loaded from the default config.
                </p>
              ) : (
                <div className="space-y-2">
                  {ruleTypes.map(ruleType => {
                    const typeRules = rules.filter(r => r.type === ruleType.value);
                    if (typeRules.length === 0) return null;

                    return (
                      <div key={ruleType.value} className="mb-4">
                        <h3 className="text-sm font-medium text-[var(--ink-muted)] mb-2">
                          {ruleType.label}
                        </h3>
                        <div className="space-y-1">
                          {typeRules.map(rule => (
                            <div
                              key={rule.id}
                              className={`flex items-center gap-3 p-2 rounded-lg ${
                                rule.enabled ? 'bg-[var(--cream-dark)]/50' : 'bg-gray-100 opacity-60'
                              }`}
                            >
                              <button
                                onClick={() => handleToggleRule(rule.id, !rule.enabled)}
                                className={`w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer ${
                                  rule.enabled
                                    ? 'bg-[var(--accent)] border-[var(--accent)]'
                                    : 'border-gray-300'
                                }`}
                              >
                                {rule.enabled && (
                                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </button>
                              <code className="flex-1 text-sm font-mono">{rule.pattern}</code>
                              <span className="text-xs text-[var(--ink-muted)]">+{rule.weight}</span>
                              <button
                                onClick={() => handleDeleteRule(rule.id)}
                                className="text-red-500 hover:text-red-700 cursor-pointer"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Blocklist Tab */}
        {activeTab === 'blocklist' && (
          <div className="bg-white rounded-xl border border-[var(--border)] p-6">
            <h2 className="text-lg font-serif font-medium text-[var(--ink)] mb-4">
              Blocklist ({blocklist.length})
            </h2>
            <p className="text-sm text-[var(--ink-muted)] mb-4">
              Companies and keywords blocked from "Not a Fit" feedback. These are automatically excluded from future searches.
            </p>

            {blocklist.length === 0 ? (
              <p className="text-sm text-[var(--ink-muted)] italic">
                No blocked items yet. Mark jobs as "Not a Fit" to build your blocklist.
              </p>
            ) : (
              <div className="space-y-2">
                {blocklist.map(entry => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-[var(--cream-dark)]/50"
                  >
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      entry.type === 'company' ? 'bg-red-100 text-red-700' :
                      entry.type === 'keyword' ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {entry.type}
                    </span>
                    <span className="flex-1 font-medium">{entry.value}</span>
                    {entry.reason && (
                      <span className="text-xs text-[var(--ink-muted)]">{entry.reason}</span>
                    )}
                    <button
                      onClick={() => handleDeleteBlocklist(entry.id)}
                      className="text-red-500 hover:text-red-700 cursor-pointer"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
