import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { UploadCloud, FileText, RefreshCw, Wand2, Download } from 'lucide-react';

type BulkJobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed';
type BulkJob = {
  id: number;
  status: BulkJobStatus | string;
  total_rows?: number;
  processed_rows?: number;
  error_count?: number;
};

type ToneType =
  | 'Professional/Respectful/Formal'
  | 'Friendly & Conversational'
  | 'Casual'
  | 'Humorous/Playful/Funny'
  | 'Empathetic/Supportive/Sympathetic'
  | 'Casual-Respectful'
  | 'Concise/Direct'
  | 'Decisive/Authoritative'
  | 'Cheerful/Enthusiastic/Joyful'
  | 'Encouraging/Inspiring'
  | 'Persuasive'
  | 'Informative'
  | 'Warm & Welcoming'
  | 'Optimistic'
  | 'Authoritative'
  | 'Conversational'
  | 'Urgent';

type ToneSelection = ToneType | '';

type LengthType = 'Short (50–75 words)' | 'Medium (75–125 words)' | 'Long (>125 words)' | 'Custom';

const TONE_GUIDE: Array<{ name: ToneType; description: string }> = [
  { name: 'Professional/Respectful/Formal', description: 'Polished and formal—proper grammar, no slang.' },
  { name: 'Friendly & Conversational', description: 'Warm and human—reads like a real conversation.' },
  { name: 'Casual', description: 'Relaxed and informal; emojis are okay.' },
  { name: 'Humorous/Playful/Funny', description: 'Light humor to stand out—only if it fits the audience.' },
  { name: 'Empathetic/Supportive/Sympathetic', description: 'Supportive and understanding; gentle wording.' },
  { name: 'Casual-Respectful', description: 'Polite and approachable—not stiff.' },
  { name: 'Concise/Direct', description: 'Straight to the point; minimal fluff.' },
  { name: 'Decisive/Authoritative', description: 'Confident and directive; clear next steps.' },
  { name: 'Cheerful/Enthusiastic/Joyful', description: 'Upbeat and energetic; celebratory vibe.' },
  { name: 'Encouraging/Inspiring', description: 'Motivational and supportive; nudges action.' },
  { name: 'Persuasive', description: 'Benefit-led and convincing; strong CTA.' },
  { name: 'Informative', description: 'Fact-based and clear; explains what and why.' },
  { name: 'Warm & Welcoming', description: 'Inviting and friendly; makes readers feel valued.' },
  { name: 'Optimistic', description: 'Positive and future-focused.' },
  { name: 'Authoritative', description: 'Expert voice; confident and credible.' },
  { name: 'Conversational', description: 'Dialogue-like and natural; feels peer-to-peer.' },
  { name: 'Urgent', description: 'Time-sensitive and action-focused (use sparingly).' },
];

type BulkFormData = {
  valueProp: string;
  tone: ToneSelection;
  length: LengthType;
  customLength: string;
  callToAction: string;
  subject: string;
  followUpCount: string;
  followUpPrompts: string;
  instructions: string;
};

const INITIAL_DATA: BulkFormData = {
  valueProp: '',
  tone: '',
  length: 'Medium (75–125 words)',
  customLength: '',
  callToAction: '',
  subject: '',
  followUpCount: '0',
  followUpPrompts: '',
  instructions: '',
};

function isBlank(value: string) {
  return String(value || '').trim().length === 0;
}

function getToneBestFor(toneName: ToneType) {
  const bestFor: Record<ToneType, string> = {
    'Professional/Respectful/Formal': 'Best for: formal intros, proposals, enterprise.',
    'Friendly & Conversational': 'Best for: cold outreach and follow-ups.',
    'Casual': 'Best for: people you already know.',
    'Humorous/Playful/Funny': 'Best for: playful brands (use carefully).',
    'Empathetic/Supportive/Sympathetic': 'Best for: support, apologies, sensitive topics.',
    'Casual-Respectful': 'Best for: polite cold outreach to strangers.',
    'Concise/Direct': 'Best for: busy execs; quick and clear.',
    'Decisive/Authoritative': 'Best for: decisions, next steps, deadlines.',
    'Cheerful/Enthusiastic/Joyful': 'Best for: wins, launches, celebrations.',
    'Encouraging/Inspiring': 'Best for: motivating action and momentum.',
    'Persuasive': 'Best for: sales offers and strong CTAs.',
    'Informative': 'Best for: updates, instructions, clarity.',
    'Warm & Welcoming': 'Best for: hospitality and consumer brands.',
    'Optimistic': 'Best for: positive framing and future-focused notes.',
    'Authoritative': 'Best for: expertise and thought leadership.',
    'Conversational': 'Best for: human-sounding cold emails.',
    'Urgent': 'Best for: real deadlines or limited-time offers.',
  };

  return bestFor[toneName] || 'Best for: choose what matches your voice.';
}

function getToneServiceFit(toneName: ToneType) {
  const serviceFit: Record<ToneType, string> = {
    'Professional/Respectful/Formal': 'Enterprise SaaS, finance, legal, IT/security, B2B procurement.',
    'Friendly & Conversational': 'Agencies, consultants, B2B SaaS, outbound for most services.',
    'Casual': 'Creators, community-led brands, partners, warm intros.',
    'Humorous/Playful/Funny': 'Marketing/design studios, DTC, content brands (brand-safe only).',
    'Empathetic/Supportive/Sympathetic': 'Healthcare, HR/recruiting, customer success, sensitive situations.',
    'Casual-Respectful': 'Local services, web/dev shops, B2B services to new prospects.',
    'Concise/Direct': 'Dev tools, operators/execs, RevOps, high-volume outbound.',
    'Decisive/Authoritative': 'Project-based services, audits, compliance, time-sensitive offers.',
    'Cheerful/Enthusiastic/Joyful': 'Events, launches, communities, partnerships, creator-led brands.',
    'Encouraging/Inspiring': 'Coaching, education, wellness, community programs.',
    'Persuasive': 'Lead-gen services, performance marketing, sales-led offers.',
    'Informative': 'Onboarding, product updates, technical services, explainers.',
    'Warm & Welcoming': 'Hospitality, consumer services, relationship-led outbound.',
    'Optimistic': 'Startups, innovation-led teams, new initiatives.',
    'Authoritative': 'Strategy/consulting, technical experts, founders, thought leadership.',
    'Conversational': 'Most B2B services, founders, agencies—when you want “human”.',
    'Urgent': 'Promos, deadlines, renewals, last-call scheduling (use sparingly).',
  };

  return serviceFit[toneName] || 'Most B2B services—pick what matches your brand.';
}

export function BulkCopyWriter() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [formData, setFormData] = useState<BulkFormData>(INITIAL_DATA);
  const [showErrors, setShowErrors] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [jobs, setJobs] = useState<BulkJob[]>([]);
  const pollIntervalRef = useRef<number | null>(null);
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch('/api/jobs');
        const json = await res.json().catch(() => null);
        if (!res.ok) return;
        const list = Array.isArray(json?.jobs) ? (json.jobs as BulkJob[]) : [];
        if (cancelled) return;
        setJobs(list);
      } catch {
        // Best-effort load.
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);


  const selectedTone = useMemo(
    () => (formData.tone ? TONE_GUIDE.find(t => t.name === formData.tone) : undefined),
    [formData.tone]
  );
  const selectedToneBestFor = formData.tone ? getToneBestFor(formData.tone as ToneType) : '';
  const selectedToneServiceFit = formData.tone ? getToneServiceFit(formData.tone as ToneType) : '';

  useEffect(() => {
    let cancelled = false;

    const isTerminal = (status: unknown) => {
      const s = String(status || '').toLowerCase();
      return s === 'completed' || s === 'failed';
    };

    const hasActiveJobs = jobs.some((j) => j?.id && !isTerminal(j.status));
    if (!hasActiveJobs) {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    const poll = async () => {
      const active = jobs.filter((j) => j?.id && !isTerminal(j.status));
      if (!active.length) return;

      try {
        const results = await Promise.all(
          active.map(async (j) => {
            const res = await fetch(`/api/jobs/${j.id}`);
            const json = await res.json().catch(() => null);
            if (!res.ok) return null;
            return json?.job as BulkJob | null;
          })
        );

        if (cancelled) return;
        const byId = new Map<number, BulkJob>();
        for (const job of results) {
          if (job?.id) byId.set(job.id, job);
        }
        if (!byId.size) return;

        setJobs((prev) => prev.map((j) => (j?.id && byId.has(j.id) ? (byId.get(j.id) as BulkJob) : j)));
      } catch {
        // Best-effort polling; ignore transient failures.
      }
    };

    poll();
    if (!pollIntervalRef.current) {
      pollIntervalRef.current = window.setInterval(poll, 1500);
    }

    return () => {
      cancelled = true;
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [jobs]);

  const isCustomLengthValid = formData.length !== 'Custom' || (!isBlank(formData.customLength) && Number(formData.customLength) > 0);
  const validation = {
    file: !!selectedFile,
    valueProp: !isBlank(formData.valueProp),
    tone: !isBlank(formData.tone),
    length: !isBlank(formData.length),
    customLength: isCustomLengthValid,
    callToAction: !isBlank(formData.callToAction),
  };
  const isFormValid = Object.values(validation).every(Boolean);

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setSelectedFile(f);
    setSubmitError('');
    setSuccessMessage('');
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleReset = () => {
    if (window.confirm('Are you sure you want to reset the bulk creator form?')) {
      setSelectedFile(null);
      setFormData(INITIAL_DATA);
      setShowErrors(false);
      setSubmitError('');
      setSuccessMessage('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleUploadAndGenerate = async () => {
    if (!isFormValid) {
      setShowErrors(true);
      return;
    }

    if (!selectedFile) {
      setShowErrors(true);
      setSubmitError('Please select a CSV file to upload.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError('');
    setSuccessMessage('');

    try {
      const fd = new FormData();
      fd.append('file', selectedFile);

      const uploadRes = await fetch('/api/files/upload', {
        method: 'POST',
        body: fd,
      });

      const uploadJson = await uploadRes.json().catch(() => null);
      if (!uploadRes.ok) {
        const msg = uploadJson?.error || 'Upload failed. Please try again.';
        setSubmitError(msg);
        return;
      }

      const fileId = uploadJson?.file?.id;
      if (!fileId) {
        setSubmitError('Upload succeeded but no file id was returned.');
        return;
      }

      const startRes = await fetch('/api/jobs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId,
          valueProp: formData.valueProp,
          callToAction: formData.callToAction,
          subject: formData.subject,
          followUpCount: formData.followUpCount,
          followUpPrompts: formData.followUpPrompts,
          tone: formData.tone,
          length: formData.length,
          customLength: formData.customLength,
          instructions: formData.instructions,
        }),
      });

      const startJson = await startRes.json().catch(() => null);
      if (!startRes.ok) {
        const msg = startJson?.error || 'Could not start the bulk job. Please try again.';
        setSubmitError(msg);
        return;
      }

      const job = startJson?.job;
      if (job?.id) {
        setJobs((prev) => {
          const existing = prev.find((j) => j.id === job.id);
          if (existing) return prev.map((j) => (j.id === job.id ? job : j));
          return [job, ...prev];
        });
      }
      setSuccessMessage('Upload complete. Bulk job started.');
    } catch {
      setSubmitError('Not able to reach the server. Please make sure the backend is running.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getJobProgress = (job: BulkJob) => {
    const processed = Number(job.processed_rows ?? 0);
    const total = Number(job.total_rows ?? 0);
    const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((processed / total) * 100))) : 0;
    return { pct, processed, total };
  };

  const isTerminalStatus = (status: unknown) => {
    const s = String(status || '').toLowerCase();
    return s === 'completed' || s === 'failed';
  };

  const isPausedStatus = (status: unknown) => String(status || '').toLowerCase() === 'paused';

  const updateJobInState = (job: BulkJob) => {
    if (!job?.id) return;
    setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
  };

  const handleStopJob = async (jobId: number) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/stop`, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok) return;
      if (json?.job?.id) updateJobInState(json.job);
    } catch {
      // Ignore.
    }
  };

  const handleResumeJob = async (jobId: number) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/resume`, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok) return;
      if (json?.job?.id) updateJobInState(json.job);
    } catch {
      // Ignore.
    }
  };

  const handleDeleteJob = async (jobId: number) => {
    if (!window.confirm('Delete this job and its uploaded file? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
      if (!res.ok) return;
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch {
      // Ignore.
    }
  };

  return (
    <div className="space-y-8">
      <div className="bg-white/70 border border-warm-gray/10 rounded-2xl px-6 py-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-warm-gray/10 shadow-sm">
              <span className="text-xs font-semibold text-warm-gray">Bulk Creator</span>
              <span className="text-xs text-warm-gray-light">📦</span>
            </div>
            <h2 className="text-3xl font-bold text-deep-navy mt-3 leading-tight">Bulk Copy Writer</h2>
            <p className="text-sm text-warm-gray-light mt-1 leading-relaxed">
              Upload a CSV and set your offer + tone once.
            </p>
          </div>
          <div className="text-sm text-warm-gray-light">
            Required fields are marked <span className="text-red-500 font-semibold">*</span>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="hidden"
        onChange={handleFileChange}
      />

      <Card
        title="CSV / Excel upload"
        description="Upload a CSV or Excel file (.csv, .xlsx, .xls)."
        className="border-t-4 border-t-soft-blue"
      >
        <div
          role="button"
          tabIndex={0}
          onClick={openFilePicker}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openFilePicker();
            }
          }}
          className="w-full border-2 border-dashed border-warm-gray/20 bg-warm-cream/30 rounded-xl p-6 hover:border-soft-blue/50 hover:bg-soft-blue/5 transition-all duration-300"
        >
          <div className="w-full min-h-[220px] flex items-center justify-center">
            <div className="w-full max-w-[640px] flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-full bg-white/70 border border-warm-gray/10 flex items-center justify-center shadow-sm">
                <UploadCloud className="w-7 h-7 text-soft-blue" />
              </div>

              <div className="mt-4 text-base sm:text-lg font-semibold text-deep-navy">
                Click to select a CSV or Excel file
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-white/70 border border-warm-gray/10 text-xs font-semibold text-warm-gray">
                  CSV
                </span>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-white/70 border border-warm-gray/10 text-xs font-semibold text-warm-gray">
                  XLS
                </span>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-white/70 border border-warm-gray/10 text-xs font-semibold text-warm-gray">
                  XLSX
                </span>
              </div>

              <div className="mt-4 w-full max-w-[600px] text-center text-sm sm:text-[15px] text-warm-gray leading-relaxed space-y-2">
                <div>📄 Required columns: First Name, Last Name, Company</div>
                <div>🔗 One required: Website / Activity URL or Activity Context</div>
                <div>
                  📥 Sample files:{' '}
                  <a
                    href="/api/files/sample?format=csv"
                    className="text-soft-blue hover:underline font-medium"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Download sample CSV
                  </a>{' '}
                  ·{' '}
                  <a
                    href="/api/files/sample?format=xlsx"
                    className="text-soft-blue hover:underline font-medium"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Download sample Excel
                  </a>
                </div>
              </div>

              {selectedFile && (
                <div className="inline-flex items-center gap-2 text-sm text-warm-gray-light bg-white/70 border border-warm-gray/10 rounded-full px-3 py-1 mt-5">
                  <FileText className="w-4 h-4 flex-shrink-0" />
                  <span className="font-medium text-deep-navy break-all">{selectedFile.name}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card title="Bulk Email Settings" className="border-t-4 border-t-soft-blue">
        <div className="space-y-6">
          <div className="space-y-1.5">
            <label htmlFor="valueProp" className="text-sm font-semibold text-deep-navy">
              Offer Summary (what you’re offering) <span className="text-red-500">*</span>
            </label>
            <textarea
              id="valueProp"
              name="valueProp"
              value={formData.valueProp}
              onChange={handleInputChange}
              rows={2}
              placeholder="Write what services you offer and how you help."
              className={`w-full p-3 rounded-lg border bg-warm-cream/30 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent resize-y transition-all placeholder:text-warm-gray-light/70 text-warm-gray ${showErrors && !validation.valueProp ? 'border-red-300 focus:ring-red-200' : 'border-warm-gray/20'}`}
            />
            {showErrors && !validation.valueProp && <p className="text-sm text-red-600">Offer summary is required.</p>}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="tone" className="text-sm font-semibold text-deep-navy">
              Select Tone <span className="text-red-500">*</span>
            </label>
            <select
              id="tone"
              name="tone"
              value={formData.tone}
              onChange={handleInputChange}
              className={`w-full p-2.5 rounded-lg border bg-white/70 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent transition-all text-deep-navy ${showErrors && !validation.tone ? 'border-red-300 focus:ring-red-200' : 'border-warm-gray/20'}`}
            >
              <option value="">Choose a tone…</option>
              {TONE_GUIDE.map(tone => (
                <option key={tone.name} value={tone.name}>
                  {tone.name} — {tone.description}
                </option>
              ))}
            </select>
            {showErrors && !validation.tone && <p className="text-sm text-red-600">Please select a tone.</p>}

            <p className="text-sm text-warm-gray-light leading-relaxed">
              <span className="font-semibold text-accent-orange">🎛️ Tip:</span> Start with “Friendly & Conversational”; use “Urgent” only for real deadlines.
            </p>

            {selectedTone && (
              <div className="p-3 rounded-xl bg-white/70 border border-warm-gray/10">
                <p className="text-sm text-warm-gray-light leading-relaxed">
                  <span className="text-xs font-semibold text-deep-navy bg-white border border-warm-gray/10 rounded-full px-2 py-0.5">
                    {selectedToneBestFor}
                  </span>
                </p>
                <p className="text-sm text-warm-gray-light leading-relaxed mt-2">{selectedTone.description}</p>
                <p className="text-sm text-warm-gray-light leading-relaxed mt-2">
                  <span className="font-semibold text-warm-gray">Service fit:</span> {selectedToneServiceFit}
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label htmlFor="length" className="text-sm font-semibold text-deep-navy">
                Copy Length <span className="text-red-500">*</span>
              </label>
              <select
                id="length"
                name="length"
                value={formData.length}
                onChange={handleInputChange}
                className="w-full p-2.5 rounded-lg border border-accent-orange/25 bg-gentle-orange-light/25 focus:bg-white focus:ring-2 focus:ring-accent-orange focus:border-transparent transition-all text-deep-navy"
              >
                <option value="Short (50–75 words)">Short (50–75 words)</option>
                <option value="Medium (75–125 words)">Medium (75–125 words)</option>
                <option value="Long (>125 words)">Long (&gt;125 words)</option>
                <option value="Custom">Custom</option>
              </select>
            </div>

            {formData.length === 'Custom' && (
              <div className="space-y-1.5 animate-in slide-in-from-right-2 duration-300">
                <label htmlFor="customLength" className="text-sm font-medium text-warm-gray">
                  Word Count <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  id="customLength"
                  name="customLength"
                  value={formData.customLength}
                  onChange={handleInputChange}
                  placeholder="e.g. 150"
                  min="1"
                  className={`w-full p-2.5 rounded-lg border bg-warm-cream/30 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent transition-all placeholder:text-warm-gray-light/70 text-warm-gray ${showErrors && !validation.customLength ? 'border-red-300 focus:ring-red-200' : 'border-warm-gray/20'}`}
                />
                {showErrors && !validation.customLength && <p className="text-xs text-red-600">Please enter a valid word count.</p>}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="callToAction" className="text-sm font-semibold text-deep-navy">
              Call to Action <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="callToAction"
              name="callToAction"
              value={formData.callToAction}
              onChange={handleInputChange}
              placeholder="e.g. Worth exploring?"
              className={`w-full p-2.5 rounded-lg border bg-warm-cream/30 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent transition-all placeholder:text-warm-gray-light/70 text-warm-gray ${showErrors && !validation.callToAction ? 'border-red-300 focus:ring-red-200' : 'border-warm-gray/20'}`}
            />
            {showErrors && !validation.callToAction && <p className="text-sm text-red-600">Call to action is required.</p>}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="subject" className="text-sm font-semibold text-deep-navy">
              Subject (optional)
            </label>
            <input
              type="text"
              id="subject"
              name="subject"
              value={formData.subject}
              onChange={handleInputChange}
              placeholder="Leave blank to auto-generate"
              className="w-full p-2.5 rounded-lg border border-warm-gray/20 bg-warm-cream/30 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent transition-all placeholder:text-warm-gray-light/70 text-warm-gray"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label htmlFor="followUpCount" className="text-sm font-semibold text-deep-navy">
                Follow-up emails
              </label>
              <select
                id="followUpCount"
                name="followUpCount"
                value={formData.followUpCount}
                onChange={handleInputChange}
                className="w-full p-2.5 rounded-lg border border-accent-orange/25 bg-gentle-orange-light/25 focus:bg-white focus:ring-2 focus:ring-accent-orange focus:border-transparent transition-all text-deep-navy"
              >
                <option value="0">0 (no follow-ups)</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
                <option value="6">6</option>
                <option value="7">7</option>
                <option value="8">8</option>
                <option value="9">9</option>
                <option value="10">10</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="followUpPrompts" className="text-sm font-semibold text-deep-navy">
                Follow-up prompts (optional)
              </label>
              <textarea
                id="followUpPrompts"
                name="followUpPrompts"
                value={formData.followUpPrompts}
                onChange={handleInputChange}
                rows={2}
                placeholder="e.g. Follow-up 1: ask if this is relevant. Follow-up 2: offer to share 2 examples."
                className="w-full p-3 rounded-lg border border-warm-gray/20 bg-warm-cream/30 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent resize-y transition-all placeholder:text-warm-gray-light/70 text-warm-gray"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="instructions" className="text-sm font-semibold text-deep-navy">
              Additional Instructions (textarea)
            </label>
            <textarea
              id="instructions"
              name="instructions"
              value={formData.instructions}
              onChange={handleInputChange}
              rows={3}
              placeholder="Any specific phrases, constraints, or style preferences..."
              className="w-full p-3 rounded-lg border border-warm-gray/20 bg-warm-cream/30 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent resize-y transition-all placeholder:text-warm-gray-light/70 text-warm-gray"
            />
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-warm-gray/10">
            <Button
              variant="ghost"
              onClick={handleReset}
              className="text-warm-gray-light hover:text-red-500"
              leftIcon={<RefreshCw className="w-4 h-4" />}
            >
              Reset
            </Button>
            <div className="flex flex-col items-end gap-2">
              {showErrors && (!validation.file || !isFormValid) && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  Please select a CSV file and fill required fields.
                </div>
              )}
              {submitError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 max-w-[520px] text-right">
                  {submitError}
                </div>
              )}
              {successMessage && (
                <div className="text-sm text-success-green bg-success-green/10 border border-success-green/20 rounded-lg px-3 py-2 max-w-[520px] text-right">
                  {successMessage}
                </div>
              )}
              <Button
                onClick={handleUploadAndGenerate}
                isLoading={isSubmitting}
                disabled={isSubmitting}
                leftIcon={<Wand2 className="w-4 h-4" />}
                className="px-8"
              >
                Upload / Generate
              </Button>
            </div>
          </div>


          <div className="mt-6">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-deep-navy">Jobs</div>
              <div className="text-xs text-warm-gray-light">
                {jobs.length ? `${jobs.length} total` : 'No jobs yet'}
              </div>
            </div>

            <div className="mt-3 space-y-3">
              {jobs.map((job) => {
                const progress = getJobProgress(job);
                const statusUpper = String(job.status || '').toUpperCase();
                const isDone = isTerminalStatus(job.status);
                const isPaused = isPausedStatus(job.status);

                return (
                  <div key={job.id} className="w-full bg-white/70 border border-warm-gray/10 rounded-xl p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-deep-navy">Job #{job.id}</div>
                      <div
                        className={`text-xs font-semibold rounded-full px-2 py-0.5 border ${
                          String(job.status || '').toLowerCase() === 'failed'
                            ? 'text-red-600 bg-red-50 border-red-100'
                            : String(job.status || '').toLowerCase() === 'completed'
                              ? 'text-success-green bg-success-green/10 border-success-green/20'
                              : 'text-warm-gray bg-white border-warm-gray/10'
                        }`}
                      >
                        Status: {statusUpper}
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="h-2.5 rounded-full bg-warm-gray/10 overflow-hidden w-full">
                        <div className="h-full bg-soft-blue transition-all" style={{ width: `${progress.pct}%` }} />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-warm-gray-light">
                        <span>
                          {progress.processed}/{progress.total || 0} rows
                          {Number(job.error_count || 0) > 0 ? ` · ${job.error_count} errors` : ''}
                        </span>
                        <span>{progress.pct}%</span>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-end gap-2">
                      {!isDone && !isPaused && (
                        <span className="text-xs text-warm-gray-light">Live updating…</span>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (!job?.id) return;
                          window.location.href = `/api/jobs/${job.id}/download`;
                        }}
                        leftIcon={<Download className="w-4 h-4" />}
                      >
                        Download
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (!job?.id) return;
                          if (isPaused) handleResumeJob(job.id);
                          else handleStopJob(job.id);
                        }}
                      >
                        {isPaused ? 'Start' : 'Stop'}
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (!job?.id) return;
                          handleDeleteJob(job.id);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}