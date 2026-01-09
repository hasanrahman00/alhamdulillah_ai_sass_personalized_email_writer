import React, { useState } from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Wand2, Copy, Check, AlertCircle, RefreshCw } from 'lucide-react';
type ToneType = 'Professional/Respectful/Formal' | 'Friendly & Conversational' | 'Casual' | 'Humorous/Playful/Funny' | 'Empathetic/Supportive/Sympathetic' | 'Casual-Respectful' | 'Concise/Direct' | 'Decisive/Authoritative' | 'Cheerful/Enthusiastic/Joyful' | 'Encouraging/Inspiring' | 'Persuasive' | 'Informative' | 'Warm & Welcoming' | 'Optimistic' | 'Authoritative' | 'Conversational' | 'Urgent';
type ToneSelection = ToneType | '';
type LengthType = 'Short (50–75 words)' | 'Medium (75–125 words)' | 'Long (>125 words)' | 'Custom';
interface FormData {
  recipientName: string;
  recipientRole: string;
  companyName: string;
  companyUrl: string;
  valueProp: string;
  callToAction: string;
  subject: string;
  followUpCount: string;
  followUpPrompts: string;
  tone: ToneSelection;
  length: LengthType;
  customLength: string;
  instructions: string;
  senderName: string;
  senderTitle: string;
  senderCompany: string;
}
const TONE_GUIDE: Array<{
  name: ToneType;
  description: string;
}> = [{
  name: 'Professional/Respectful/Formal',
  description: 'Polished and formal—proper grammar, no slang.'
}, {
  name: 'Friendly & Conversational',
  description: 'Warm and human—reads like a real conversation.'
}, {
  name: 'Casual',
  description: 'Relaxed and informal; emojis are okay.'
}, {
  name: 'Humorous/Playful/Funny',
  description: 'Light humor to stand out—only if it fits the audience.'
}, {
  name: 'Empathetic/Supportive/Sympathetic',
  description: 'Supportive and understanding; gentle wording.'
}, {
  name: 'Casual-Respectful',
  description: 'Polite and approachable—not stiff.'
}, {
  name: 'Concise/Direct',
  description: 'Straight to the point; minimal fluff.'
}, {
  name: 'Decisive/Authoritative',
  description: 'Confident and directive; clear next steps.'
}, {
  name: 'Cheerful/Enthusiastic/Joyful',
  description: 'Upbeat and energetic; celebratory vibe.'
}, {
  name: 'Encouraging/Inspiring',
  description: 'Motivational and supportive; nudges action.'
}, {
  name: 'Persuasive',
  description: 'Benefit-led and convincing; strong CTA.'
}, {
  name: 'Informative',
  description: 'Fact-based and clear; explains what and why.'
}, {
  name: 'Warm & Welcoming',
  description: 'Inviting and friendly; makes readers feel valued.'
}, {
  name: 'Optimistic',
  description: 'Positive and future-focused.'
}, {
  name: 'Authoritative',
  description: 'Expert voice; confident and credible.'
}, {
  name: 'Conversational',
  description: 'Dialogue-like and natural; feels peer-to-peer.'
}, {
  name: 'Urgent',
  description: 'Time-sensitive and action-focused (use sparingly).' 
}];
const INITIAL_DATA: FormData = {
  recipientName: '',
  recipientRole: '',
  companyName: '',
  companyUrl: '',
  valueProp: '',
  callToAction: '',
  subject: '',
  followUpCount: '0',
  followUpPrompts: '',
  tone: '',
  length: 'Medium (75–125 words)',
  customLength: '',
  instructions: '',
  senderName: '',
  senderTitle: '',
  senderCompany: ''
};
export function SingleCopyWriter() {
  const [formData, setFormData] = useState<FormData>(INITIAL_DATA);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState('');
  const [copied, setCopied] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const getToneBestFor = (toneName: ToneType) => {
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
      'Urgent': 'Best for: real deadlines or limited-time offers.'
    };

    return bestFor[toneName] || 'Best for: choose what matches your voice.';
  };

  const parseEmailBlocks = (text: string) => {
    const raw = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!raw) return [] as Array<{ type: string; subject: string; body: string }>;

    const lines = raw.split('\n');
    const blocks: Array<{ type: string; subject: string; bodyLines: string[] }> = [];
    let current: { type: string; subject: string; bodyLines: string[] } | null = null;

    const parseHeader = (line: string) => {
      const s = String(line || '').trim();
      if (!s) return null;
      const m1 = /^Type:\s*(.+?)\s*\|\s*Subject:\s*(.*)$/i.exec(s);
      if (m1) return { type: String(m1[1] || '').trim(), subject: String(m1[2] || '').trim() };
      const m2 = /^Subject:\s*(.*)$/i.exec(s);
      if (m2) return { type: '', subject: String(m2[1] || '').trim() };
      return null;
    };

    const pushCurrent = () => {
      if (!current) return;
      blocks.push(current);
    };

    for (let i = 0; i < lines.length; i++) {
      const line = String(lines[i] || '');
      const header = parseHeader(line);

      if (header) {
        pushCurrent();
        current = { type: header.type, subject: header.subject, bodyLines: [] };

        // Back-compat: older output might have a standalone Type: line on the next line.
        const next = String(lines[i + 1] || '').trim();
        if (!current.type && /^Type:\s*/i.test(next) && !/\|\s*Subject:\s*/i.test(next)) {
          current.type = next.replace(/^Type:\s*/i, '').trim();
          i += 1;
        }

        continue;
      }

      if (!current) {
        current = { type: '', subject: '', bodyLines: [] };
      }

      current.bodyLines.push(line);
    }

    pushCurrent();
    return blocks
      .map(b => ({
        type: String(b.type || '').trim(),
        subject: String(b.subject || '').trim(),
        body: String(b.bodyLines.join('\n') || '').trim(),
      }))
      .filter(b => b.subject || b.body);
  };

  const isBlank = (value: string) => value.trim().length === 0;
  const hasActivityOrUrl = !isBlank(formData.companyUrl);
  const isCustomLengthValid = formData.length !== 'Custom' || (!isBlank(formData.customLength) && Number(formData.customLength) > 0);
  const validation = {
    recipientName: !isBlank(formData.recipientName),
    companyName: !isBlank(formData.companyName),
    activityOrUrl: hasActivityOrUrl,
    callToAction: !isBlank(formData.callToAction),
    tone: !isBlank(formData.tone),
    length: !isBlank(formData.length),
    customLength: isCustomLengthValid,
    senderName: !isBlank(formData.senderName),
    senderTitle: !isBlank(formData.senderTitle),
    senderCompany: !isBlank(formData.senderCompany)
  };
  const isFormValid = Object.values(validation).every(Boolean);
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const {
      name,
      value
    } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };
  const handleGenerate = async () => {
    if (!isFormValid) {
      setShowErrors(true);
      return;
    }

    setGenerateError('');
    setIsGenerating(true);

    try {
      const res = await fetch('/api/single/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientName: formData.recipientName,
          recipientRole: formData.recipientRole,
          companyName: formData.companyName,
          companyUrl: formData.companyUrl,
          activityText: '',
          valueProp: formData.valueProp,
          callToAction: formData.callToAction,
          subject: formData.subject,
          followUpCount: formData.followUpCount,
          followUpPrompts: formData.followUpPrompts,
          tone: formData.tone,
          length: formData.length,
          customLength: formData.customLength,
          instructions: formData.instructions,
          senderName: formData.senderName,
          senderTitle: formData.senderTitle,
          senderCompany: formData.senderCompany,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = data?.error || 'Not able to generate email. Please try again.';

		// eslint-disable-next-line no-console
		console.error('Single generate failed', {
			status: res.status,
			statusText: res.statusText,
			response: data,
		});

        setGenerateError(msg);
        setResult('');
        return;
      }

      const text = String(data?.text || '').trim();
      if (text) {
        setResult(text);
        return;
      }
      const emails = Array.isArray(data?.emails) ? data.emails : [];
      if (emails.length) {
        type EmailItem = {
          type?: unknown;
          subject?: unknown;
          email?: unknown;
        };

        const formatted = emails
          .map((e: EmailItem, idx: number) => {
            const t = String(e?.type || '').trim();
            const s = String(e?.subject || '').trim();
            const b = String(e?.email || '').trim();
            const inferredType = t || (idx === 0 ? 'Initial' : `Follow-up ${idx}`);
            const header = `Type: ${inferredType} | Subject: ${s}`.trim();
            return s ? `${header}\n\n${b}` : b;
          })
          .filter(Boolean)
          .join('\n\n');
        setResult(formatted);
        return;
      }
      const subject = String(data?.subject || '').trim();
      const email = String(data?.email || '').trim();
      setResult(subject ? `Type: Initial | Subject: ${subject}\n\n${email}` : email);
    } catch {
      setGenerateError('Not able to reach the server. Please make sure the backend is running.');
      setResult('');
    } finally {
      setIsGenerating(false);
    }
  };
  const handleCopy = () => {
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const handleClear = () => {
    if (window.confirm('Are you sure you want to clear the form?')) {
      setFormData(INITIAL_DATA);
      setResult('');
      setShowErrors(false);
      setGenerateError('');
    }
  };
  const selectedTone = formData.tone ? TONE_GUIDE.find(t => t.name === formData.tone) : undefined;
  const selectedToneBestFor = formData.tone ? getToneBestFor(formData.tone as ToneType) : '';
  return <div className="space-y-8">
      <div className="bg-white/70 border border-warm-gray/10 rounded-2xl px-6 py-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-warm-gray/10 shadow-sm">
              <span className="text-xs font-semibold text-warm-gray">Single Copy</span>
              <span className="text-xs text-warm-gray-light">✍️</span>
            </div>
            <h2 className="text-3xl font-bold text-deep-navy mt-3 leading-tight">
              Single Copy Writer
            </h2>
            <p className="text-sm text-warm-gray-light mt-1 leading-relaxed">
              ✨ Add real context + a clear offer for the best personalization.
            </p>
          </div>
          <div className="text-sm text-warm-gray-light">
            Required fields are marked <span className="text-red-500 font-semibold">*</span>
          </div>
        </div>
      </div>
      {/* Top Section: Form */}
      <div className="grid grid-cols-1 gap-6">
        {/* Copy Details Form */}
        <div>
          <Card title="Email Inputs (for personalization)" className="border-t-4 border-t-soft-blue">
            <div className="space-y-6">
              {/* Recipient Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label htmlFor="recipientName" className="text-sm font-semibold text-deep-navy">
                    Recipient First Name <span className="text-red-500">*</span>
                  </label>
                  <input type="text" id="recipientName" name="recipientName" value={formData.recipientName} onChange={handleInputChange} placeholder="e.g. Sarah" className={`w-full p-2.5 rounded-lg border bg-warm-cream/30 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent transition-all placeholder:text-warm-gray-light/70 text-warm-gray ${showErrors && !validation.recipientName ? 'border-red-300 focus:ring-red-200' : 'border-warm-gray/20'}`} />
                  {showErrors && !validation.recipientName && <p className="text-sm text-red-600">Recipient first name is required.</p>}
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="recipientRole" className="text-sm font-semibold text-deep-navy">
                    Job Title / Role
                  </label>
                  <input type="text" id="recipientRole" name="recipientRole" value={formData.recipientRole} onChange={handleInputChange} placeholder="e.g. Marketing Director" className="w-full p-2.5 rounded-lg border border-warm-gray/20 bg-warm-cream/30 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent transition-all placeholder:text-warm-gray-light/70 text-warm-gray" />
                </div>
              </div>

              {/* Company Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label htmlFor="companyName" className="text-sm font-semibold text-deep-navy">
                    Company Name <span className="text-red-500">*</span>
                  </label>
                  <input type="text" id="companyName" name="companyName" value={formData.companyName} onChange={handleInputChange} placeholder="e.g. Acme Corp" className={`w-full p-2.5 rounded-lg border bg-warm-cream/30 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent transition-all placeholder:text-warm-gray-light/70 text-warm-gray ${showErrors && !validation.companyName ? 'border-red-300 focus:ring-red-200' : 'border-warm-gray/20'}`} />
                  {showErrors && !validation.companyName && <p className="text-sm text-red-600">Company name is required.</p>}
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="companyUrl" className="text-sm font-semibold text-deep-navy">
                    Recipient Website / Activity URL <span className="text-red-500">*</span>
                  </label>
                  <textarea id="companyUrl" name="companyUrl" value={formData.companyUrl} onChange={handleInputChange} rows={4} placeholder="Paste a URL (https://...) OR paste activity context (news, post, announcement) — used for personalization..." className={`w-full p-3 min-h-[120px] rounded-lg border bg-warm-cream/30 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent resize-y transition-all placeholder:text-warm-gray-light/70 text-warm-gray ${showErrors && !validation.activityOrUrl ? 'border-red-300 focus:ring-red-200' : 'border-warm-gray/20'}`} />
                  <p className="text-sm text-warm-gray-light leading-relaxed">
                    <span className="font-semibold text-accent-orange">✨ Best:</span> use a public page (no login).
                  </p>
                  {showErrors && !validation.activityOrUrl && <p className="text-sm text-red-600">Please add activity context (URL or pasted text).</p>}
                </div>
              </div>

              {/* URL Warning */}
              <div className="flex items-start gap-2 p-3 bg-gentle-orange-light/25 rounded-xl border border-accent-orange/15 text-deep-navy text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p>
                  If you use a URL, please do not enter URLs that require a login (e.g. LinkedIn,
                  Quora, Twitter, Instagram, Glassdoor, NYT, OnlyFans).
                </p>
              </div>

              {/* Context Fields */}
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="valueProp" className="text-sm font-semibold text-deep-navy">
                    Offer Summary (what you’re offering)
                  </label>
                  <textarea id="valueProp" name="valueProp" value={formData.valueProp} onChange={handleInputChange} rows={2} placeholder="Write what services you offer and how you help." className="w-full p-3 rounded-lg border border-warm-gray/20 bg-warm-cream/30 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent resize-y transition-all placeholder:text-warm-gray-light/70 text-warm-gray" />
                  <p className="text-sm text-warm-gray-light leading-relaxed">
                    <span className="font-semibold text-accent-orange">🎯 Include:</span> service + who it’s for + outcome (+ 1 proof point).
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="tone" className="text-sm font-semibold text-deep-navy">
                    Select Tone <span className="text-red-500">*</span>
                  </label>
                  <select id="tone" name="tone" value={formData.tone} onChange={handleInputChange} className={`w-full p-2.5 rounded-lg border bg-white/70 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent transition-all text-deep-navy ${showErrors && !validation.tone ? 'border-red-300 focus:ring-red-200' : 'border-warm-gray/20'}`}>
                    <option value="">Choose a tone…</option>
                    {TONE_GUIDE.map(tone => <option key={tone.name} value={tone.name}>
                        {tone.name} — {tone.description}
                      </option>)}
                  </select>
                  {showErrors && !validation.tone && <p className="text-sm text-red-600">Please select a tone.</p>}

                  <p className="text-sm text-warm-gray-light leading-relaxed">
                    <span className="font-semibold text-accent-orange">🎛️ Tip:</span> Start with “Friendly & Conversational”; use “Urgent” only for real deadlines.
                  </p>

                  {selectedTone && <div className="p-3 rounded-xl bg-white/70 border border-warm-gray/10">
                      <p className="text-sm text-warm-gray-light leading-relaxed">
                        <span className="text-xs font-semibold text-deep-navy bg-white border border-warm-gray/10 rounded-full px-2 py-0.5">
                          {selectedToneBestFor}
                        </span>
                      </p>
                      <p className="text-sm text-warm-gray-light leading-relaxed mt-2">
                        {selectedTone.description}
                      </p>
                    </div>}
                </div>
              </div>

              {/* Length Selection */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label htmlFor="length" className="text-sm font-semibold text-deep-navy">
                    Copy Length <span className="text-red-500">*</span>
                  </label>
                  <select id="length" name="length" value={formData.length} onChange={handleInputChange} className="w-full p-2.5 rounded-lg border border-accent-orange/25 bg-gentle-orange-light/25 focus:bg-white focus:ring-2 focus:ring-accent-orange focus:border-transparent transition-all text-deep-navy">
                    <option value="Short (50–75 words)">
                      Short (50–75 words)
                    </option>
                    <option value="Medium (75–125 words)">
                      Medium (75–125 words)
                    </option>
                    <option value="Long (>125 words)">
                      Long (&gt;125 words)
                    </option>
                    <option value="Custom">Custom</option>
                  </select>
                  <p className="text-sm text-warm-gray-light leading-relaxed">
                    <span className="font-semibold text-accent-orange">⭐ Recommendation:</span> Medium by default; Short for execs; Long only if needed.
                  </p>
                </div>

                {formData.length === 'Custom' && <div className="space-y-1.5 animate-in slide-in-from-right-2 duration-300">
                    <label htmlFor="customLength" className="text-sm font-medium text-warm-gray">
                      Word Count <span className="text-red-500">*</span>
                    </label>
                    <input type="number" id="customLength" name="customLength" value={formData.customLength} onChange={handleInputChange} placeholder="e.g. 150" min="1" className={`w-full p-2.5 rounded-lg border bg-warm-cream/30 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent transition-all placeholder:text-warm-gray-light/70 text-warm-gray ${showErrors && !validation.customLength ? 'border-red-300 focus:ring-red-200' : 'border-warm-gray/20'}`} />
                    {showErrors && !validation.customLength && <p className="text-xs text-red-600">Please enter a valid word count.</p>}
                  </div>}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="callToAction" className="text-sm font-semibold text-deep-navy">
                  Call to Action <span className="text-red-500">*</span>
                </label>
                <input type="text" id="callToAction" name="callToAction" value={formData.callToAction} onChange={handleInputChange} placeholder="e.g. Schedule a 15-min call" className={`w-full p-2.5 rounded-lg border bg-warm-cream/30 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent transition-all placeholder:text-warm-gray-light/70 text-warm-gray ${showErrors && !validation.callToAction ? 'border-red-300 focus:ring-red-200' : 'border-warm-gray/20'}`} />
                {showErrors && !validation.callToAction && <p className="text-sm text-red-600">Call to action is required.</p>}
                <p className="text-sm text-warm-gray-light leading-relaxed">
                  <span className="font-semibold text-accent-orange">✅ Recommendation:</span> keep it low-friction (e.g., “Worth exploring?”).
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="subject" className="text-sm font-semibold text-deep-navy">
                  Subject (optional)
                </label>
                <input type="text" id="subject" name="subject" value={formData.subject} onChange={handleInputChange} placeholder="e.g. Quick question about your Q4 goals" className="w-full p-2.5 rounded-lg border border-warm-gray/20 bg-warm-cream/30 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent transition-all placeholder:text-warm-gray-light/70 text-warm-gray" />
                <p className="text-sm text-warm-gray-light leading-relaxed">
                  <span className="font-semibold text-accent-orange">✨ Recommendation:</span> leave blank to auto-generate; if filled, used for the initial email only.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label htmlFor="followUpCount" className="text-sm font-semibold text-deep-navy">
                    Follow-up emails
                  </label>
                  <select id="followUpCount" name="followUpCount" value={formData.followUpCount} onChange={handleInputChange} className="w-full p-2.5 rounded-lg border border-accent-orange/25 bg-gentle-orange-light/25 focus:bg-white focus:ring-2 focus:ring-accent-orange focus:border-transparent transition-all text-deep-navy">
                    <option value="0">0 (no follow-ups)</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                  </select>
                  <p className="text-sm text-warm-gray-light leading-relaxed">
                    <span className="font-semibold text-accent-orange">📌 Recommendation:</span> default to 3 follow-ups; choose 0 for only the first email.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="followUpPrompts" className="text-sm font-semibold text-deep-navy">
                    Follow-up prompts (optional)
                  </label>
                  <textarea id="followUpPrompts" name="followUpPrompts" value={formData.followUpPrompts} onChange={handleInputChange} rows={2} placeholder="e.g. Follow-up 1: ask if this is relevant. Follow-up 2: offer to share 2 examples." className="w-full p-3 rounded-lg border border-warm-gray/20 bg-warm-cream/30 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent resize-y transition-all placeholder:text-warm-gray-light/70 text-warm-gray" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="instructions" className="text-sm font-semibold text-deep-navy">
                  Additional Instructions
                </label>
                <textarea id="instructions" name="instructions" value={formData.instructions} onChange={handleInputChange} rows={2} placeholder="Any specific phrases, constraints, or style preferences..." className="w-full p-3 rounded-lg border border-warm-gray/20 bg-warm-cream/30 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent resize-y transition-all placeholder:text-warm-gray-light/70 text-warm-gray" />
                <p className="text-sm text-warm-gray-light leading-relaxed">
                  <span className="font-semibold text-accent-orange">📝 Recommendation:</span> keep it short — must-include/must-avoid or one angle.
                </p>
              </div>

              {/* Sender Signature Section */}
              <div className="space-y-3">
                <h4 className="font-semibold text-warm-gray text-sm">
                  Sender Signature <span className="text-red-500">*</span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div className="space-y-1.5">
                    <label htmlFor="senderName" className="text-sm font-semibold text-deep-navy">
                      Name <span className="text-red-500">*</span>
                    </label>
                    <input type="text" id="senderName" name="senderName" value={formData.senderName} onChange={handleInputChange} placeholder="e.g. John Smith" className={`w-full p-2.5 rounded-lg border bg-warm-cream/30 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent transition-all placeholder:text-warm-gray-light/70 text-warm-gray ${showErrors && !validation.senderName ? 'border-red-300 focus:ring-red-200' : 'border-warm-gray/20'}`} />
                    {showErrors && !validation.senderName && <p className="text-sm text-red-600">Name is required.</p>}
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="senderTitle" className="text-sm font-semibold text-deep-navy">
                      Title <span className="text-red-500">*</span>
                    </label>
                    <input type="text" id="senderTitle" name="senderTitle" value={formData.senderTitle} onChange={handleInputChange} placeholder="e.g. Sales Director" className={`w-full p-2.5 rounded-lg border bg-warm-cream/30 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent transition-all placeholder:text-warm-gray-light/70 text-warm-gray ${showErrors && !validation.senderTitle ? 'border-red-300 focus:ring-red-200' : 'border-warm-gray/20'}`} />
                    {showErrors && !validation.senderTitle && <p className="text-sm text-red-600">Title is required.</p>}
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="senderCompany" className="text-sm font-semibold text-deep-navy">
                      Company <span className="text-red-500">*</span>
                    </label>
                    <input type="text" id="senderCompany" name="senderCompany" value={formData.senderCompany} onChange={handleInputChange} placeholder="e.g. Your Company" className={`w-full p-2.5 rounded-lg border bg-warm-cream/30 focus:bg-white focus:ring-2 focus:ring-soft-blue focus:border-transparent transition-all placeholder:text-warm-gray-light/70 text-warm-gray ${showErrors && !validation.senderCompany ? 'border-red-300 focus:ring-red-200' : 'border-warm-gray/20'}`} />
                    {showErrors && !validation.senderCompany && <p className="text-sm text-red-600">Company is required.</p>}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-warm-gray/10">
                <Button variant="ghost" onClick={handleClear} className="text-warm-gray-light hover:text-red-500" leftIcon={<RefreshCw className="w-4 h-4" />}>
                  Reset
                </Button>
                <div className="flex flex-col items-end gap-2">
                  {showErrors && !isFormValid && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                      Please select/fill all required fields.
                    </div>}
                  {generateError && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 max-w-[420px] text-right">
                      {generateError}
                    </div>}
                  <Button onClick={handleGenerate} isLoading={isGenerating} disabled={isGenerating} leftIcon={<Wand2 className="w-4 h-4" />} className="px-8">
                    Generate Copy
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Generated Draft Section - Full Width Below */}
      {result && <Card title="Generated Draft" className="border-t-4 border-t-soft-blue animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="space-y-4">
            {(() => {
            const blocks = parseEmailBlocks(result);
            if (!blocks.length) {
              return <div className="p-5 bg-soft-blue/5 rounded-xl border border-soft-blue/10 text-deep-navy leading-relaxed whitespace-pre-wrap font-medium text-sm">
                    {result}
                  </div>;
            }

            return <div className="space-y-3">
                  {blocks.map((b, idx) => {
                const typeText = b.type || (idx === 0 ? 'Initial' : `Follow-up ${idx}`);
                const isFollowUp = /follow[- ]?up/i.test(typeText);
                const badgeClass = isFollowUp ? 'bg-accent-orange/10 text-accent-orange border-accent-orange/20' : 'bg-soft-blue/10 text-soft-blue-dark border-soft-blue/20';

                return <div key={`${idx}-${typeText}-${b.subject}`} className="p-5 bg-white/70 rounded-xl border border-warm-gray/10">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${badgeClass}`}>
                                {typeText}
                              </span>
                              {b.subject && <div className="text-sm font-semibold text-deep-navy break-words">
                                  Subject: {b.subject}
                                </div>}
                            </div>
                          </div>
                        </div>
                        {b.body && <div className="mt-3 text-deep-navy leading-relaxed whitespace-pre-wrap font-medium text-sm">
                            {b.body}
                          </div>}
                      </div>;
              })}
                </div>;
          })()}
            <div className="flex justify-end">
              <Button variant="outline" onClick={handleCopy} leftIcon={copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}>
                {copied ? 'Copied!' : 'Copy to Clipboard'}
              </Button>
            </div>
          </div>
        </Card>}
    </div>;
}