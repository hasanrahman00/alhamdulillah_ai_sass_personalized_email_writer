const PQueue = require('p-queue').default;

const { config } = require('../config');
const { getDb } = require('../db');
const { scrapeUrlRaw } = require('../scrape/scrapeUrlRaw');
const { COLD_EMAIL_BULK_PROMPT_WITH_FOLLOW_UP_TEMPLATE } = require('../ai/bulkPrompt');
const { getToneGuidance } = require('../ai/toneGuide');
const { callDeepSeekText } = require('../ai/deepseek');

let queue;
let started = false;
let didLogBulkPromptHint = false;

function getQueue() {
	if (!queue) {
		queue = new PQueue({ concurrency: config.workerConcurrency });
	}
	return queue;
}

function isBlank(v) {
	return String(v || '').trim().length === 0;
}

function mapCopyLength(length, customLength) {
	const l = String(length || '').trim();
	if (l === 'Custom') {
		const n = Number(customLength);
		if (!Number.isFinite(n) || n <= 0) return '100';
		return String(Math.round(n));
	}
	if (l.startsWith('Short')) return '65';
	if (l.startsWith('Medium')) return '100';
	if (l.startsWith('Long')) return '150';
	return '100';
}

function fillTemplate(template, values) {
	let out = String(template);
	for (const [key, value] of Object.entries(values)) {
		out = out.split(`{${key}}`).join(String(value ?? ''));
	}
	return out;
}

function truncateForLog(text, maxChars) {
	const s = String(text ?? '');
	const n = Number(maxChars);
	if (!Number.isFinite(n) || n <= 0) return '';
	if (s.length <= n) return s;
	return `${s.slice(0, n)}\n... (truncated, ${s.length} chars total)`;
}

function normalizeNewlines(text) {
	return String(text || '').replace(/\r\n/g, '\n');
}

function stripLeadingSubject(text) {
	const raw = normalizeNewlines(text).trim();
	if (!raw) return '';
	const lines = raw.split('\n');
	let i = 0;
	// Remove one or more leading Subject lines (sometimes the model repeats them).
	while (i < lines.length && /^Subject:\s*/i.test(String(lines[i] || '').trim())) i++;
	// Remove one optional blank line after the subject.
	while (i < lines.length && String(lines[i] || '').trim() === '') i++;
	return lines.slice(i).join('\n').trim();
}

function stripTrailingSignatureOrSeparator(text) {
	const raw = normalizeNewlines(text).trim();
	if (!raw) return '';
	let lines = raw.split('\n');

	function isSeparatorLine(s) {
		const t = String(s || '').trim();
		if (!t) return false;
		return (
			/^[-_*]{3,}$/.test(t) ||
			/^(\*\s*){3,}$/.test(t) ||
			/^—{3,}$/.test(t) ||
			/^(—\s*){3,}$/.test(t)
		);
	}

	function isSignoffLine(s) {
		const t = String(s || '').trim();
		if (!t) return false;
		return /^(best|all the best|best regards|warm regards|kind regards|regards|warmly|many thanks|thanks|thanks again|thank you|with gratitude|sincerely|yours truly|cheers|respectfully),?$/.test(
			t.toLowerCase()
		);
	}

	function isSignaturePlaceholderLine(s) {
		const t = String(s || '').trim();
		if (!t) return false;
		const lower = t.toLowerCase();
		// Common placeholder tokens that should never appear in output.
		if (/^\[\s*(your name|sender name|name)\s*\]$/.test(lower)) return true;
		if (/^\{\s*(your name|sender name|name)\s*\}$/.test(lower)) return true;
		if (/^(your name|sender name|name)$/.test(lower)) return true;
		return false;
	}

	// Trim trailing blanks.
	while (lines.length && String(lines[lines.length - 1] || '').trim() === '') lines.pop();

	// If there's a separator at the end, drop it.
	while (lines.length && isSeparatorLine(lines[lines.length - 1])) {
		lines.pop();
		while (lines.length && String(lines[lines.length - 1] || '').trim() === '') lines.pop();
	}

	// If it ends with a sign-off, drop the sign-off and anything after it (e.g., a name).
	for (let i = Math.max(0, lines.length - 8); i < lines.length; i++) {
		if (isSignoffLine(lines[i])) {
			lines = lines.slice(0, i);
			break;
		}
	}

	// If the model outputs a placeholder name line at the end, strip it.
	while (lines.length && isSignaturePlaceholderLine(lines[lines.length - 1])) {
		lines.pop();
		while (lines.length && String(lines[lines.length - 1] || '').trim() === '') lines.pop();
	}

	while (lines.length && String(lines[lines.length - 1] || '').trim() === '') lines.pop();
	return lines.join('\n').trim();
}

function cleanEmailBody(text) {
	// Bulk prompt expects body to start with Hi..., and not include Subject lines or signatures.
	const withoutSubject = stripLeadingSubject(text);
	const cleaned = stripTrailingSignatureOrSeparator(withoutSubject);
	return String(cleaned || '').replace(/<br\s*\/?>/gi, '\n');
}

function splitIntoParagraphs(body) {
	const normalized = normalizeNewlines(body)
		.replace(/<br\s*\/?>/gi, '\n')
		.trim();
	if (!normalized) return [];
	return normalized
		.split(/\n\s*\n+/)
		.map((p) => String(p || '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim())
		.filter(Boolean);
}

function trySplitParagraph(p) {
	const s = String(p || '').trim();
	if (!s) return null;

	// Prefer splitting on sentence boundaries.
	const boundaries = [];
	const re = /[.!?]\s+/g;
	let m;
	while ((m = re.exec(s)) !== null) {
		const idx = m.index + 1; // include punctuation
		if (idx > 20 && idx < s.length - 20) boundaries.push(idx);
	}
	if (boundaries.length) {
		const target = Math.floor(s.length * 0.55);
		let best = boundaries[0];
		for (const b of boundaries) {
			if (Math.abs(b - target) < Math.abs(best - target)) best = b;
		}
		const a = s.slice(0, best).trim();
		const b = s.slice(best).trim();
		if (a && b) return [a, b];
	}

	// Fallback: split on a colon or semicolon if it looks natural.
	const fallback = s.match(/^(.{25,140}?[:;])\s+(.{20,})$/);
	if (fallback) {
		const a = String(fallback[1] || '').trim();
		const b = String(fallback[2] || '').trim();
		if (a && b) return [a, b];
	}

	return null;
}

function enforceBodyParagraphCount(body, targetCount) {
	const target = Number(targetCount);
	if (!Number.isFinite(target) || target <= 0) return normalizeNewlines(body).trim();

	let parts = splitIntoParagraphs(body);
	if (!parts.length) return '';

	// Merge extra paragraphs into the last kept paragraph.
	if (parts.length > target) {
		const head = parts.slice(0, Math.max(1, target - 1));
		const tail = parts.slice(Math.max(1, target - 1)).join(' ');
		parts = target === 1 ? [parts.join(' ')] : [...head, tail];
	}

	// If we have too few paragraphs, try to split a paragraph into two.
	while (parts.length < target) {
		let didSplit = false;
		for (let i = 0; i < parts.length; i++) {
			const split = trySplitParagraph(parts[i]);
			if (split) {
				parts.splice(i, 1, split[0], split[1]);
				didSplit = true;
				break;
			}
		}
		if (!didSplit) break;
	}

	// If we still have too many due to a split, re-merge.
	if (parts.length > target) {
		const head = parts.slice(0, Math.max(1, target - 1));
		const tail = parts.slice(Math.max(1, target - 1)).join(' ');
		parts = target === 1 ? [parts.join(' ')] : [...head, tail];
	}

	return parts.join('\n\n').trim();
}

function enforceEmailParagraphs(emailText, targetBodyParagraphs) {
	const raw = normalizeNewlines(emailText).trim();
	if (!raw) return '';
	const lines = raw.split('\n');
	const greeting = String(lines[0] || '').trimEnd();
	let rest = lines.slice(1);
	while (rest.length && String(rest[0] || '').trim() === '') rest.shift();
	const body = enforceBodyParagraphCount(rest.join('\n').trim(), targetBodyParagraphs);
	if (!greeting) return body;
	if (!body) return greeting;
	return `${greeting}\n\n${body}`.trim();
}

function followUpTargetParagraphs(followUpIndex1Based, desiredFollowUps) {
	const idx = Number(followUpIndex1Based);
	const n = Number(desiredFollowUps);
	if (!Number.isFinite(idx) || idx <= 0) return 2;
	if (!Number.isFinite(n) || n <= 0) return 0;
	if (n === 3) return idx === 3 ? 1 : 2;
	if (n >= 4) return idx === n ? 1 : 2;
	// n is 1 or 2
	return 2;
}

function looksLikeUnreachableOrParkedPage(text) {
	const s = String(text || '').toLowerCase();
	const compact = s.replace(/\s+/g, ' ').trim();
	if (!compact) return true;
	if (compact.length < 80) return true;
	return (
		/(domain\s+expired|this\s+domain\s+has\s+expired|domain\s+is\s+for\s+sale|buy\s+this\s+domain|domain\s+parked|parking\s+page)/i.test(
			s
		) ||
		/(404\s+not\s+found|page\s+not\s+found|site\s+can\'?t\s+be\s+reached|dns\s+probe\s+finished|name\s+not\s+resolved)/i.test(
			s
		) ||
		/(access\s+denied|error\s+1020|cloudflare|attention\s+required)/i.test(s)
	);
}

function normalizeSubjectLine(text) {
	let s = String(text || '').trim();
	if (!s) return '';
	// Normalize whitespace early.
	s = s.replace(/\s+/g, ' ').trim();
	// Strip common email gateway tags like [EXTERNAL], [SPAM], etc. Remove repeatedly.
	// Example: "[EXTERNAL] [SUSPICIOUS] Subject here"
	while (/^\[[^\]]{2,30}\]\s*/.test(s)) {
		s = s.replace(/^\[[^\]]{2,30}\]\s*/g, '').trim();
	}
	// Strip common formatting like bullets/numbers.
	s = s.replace(/^[-*\u2022\s]+/, '').trim();
	s = s.replace(/^\d+[\).\-]\s*/, '').trim();
	// Remove wrapping quotes.
	s = s.replace(/^['"“”]+|['"“”]+$/g, '').trim();
	// Remove accidental Subject: prefix.
	s = s.replace(/^Subject:\s*/i, '').trim();
	// Remove reply/forward prefixes (sometimes models add these).
	// Example: "Re: ...", "Fwd: ...", "FW - ...". Remove repeatedly.
	s = s.replace(/^((re|fw|fwd)\s*[:\-]\s*)+/i, '').trim();
	// Normalize whitespace again after prefix removal.
	s = s.replace(/\s+/g, ' ').trim();
	return s;
}

async function generateMissingSubjects({
	activitySummary,
	jobSettings,
	company,
	initialSubject,
	initialBody,
	followUpBodies,
	requestId,
}) {
	const followUpCount = followUpBodies.length;
	const promptLines = [
		'You are an expert B2B email copywriter.',
		'Generate subject lines for an initial cold email and its follow-ups.',
		'',
		'Rules (follow exactly):',
		'- Return ONLY the subject lines, one per line, with no labels and no numbering.',
		'- Each subject must be 1–8 words and under 50 characters.',
		'- Avoid question marks and exclamation points.',
		'- Avoid generic subjects like “Checking in” or “Following up”.',
		'- Do NOT add reply/forward prefixes like “Re:”, “Fwd:”, or “FW:”.',
		'- Follow-up subjects must feel like a continuation of the previous email (based on the previous subject/body) and must introduce a NEW angle or insight.',
		'- Do NOT reuse the initial subject for follow-ups.',
		'- Each subject must include either the company name OR a concrete signal/pain/benefit from the context.',
		`- Tone: ${String(jobSettings?.tone || '').trim() || 'neutral'}.`,
		'',
		`Company: ${String(company || '').trim()}`,
		'',
		'Context for personalization (only source):',
		String(activitySummary || '').trim(),
		'',
		`Initial subject (may be blank): ${String(initialSubject || '').trim()}`,
		'',
		'Initial email body:',
		String(initialBody || '').trim(),
	];

	for (let i = 0; i < followUpCount; i++) {
		const prevLabel = i === 0 ? 'Initial email' : `Follow-up ${i}`;
		promptLines.push(
			'',
			`Follow-up ${i + 1} context: (this follow-up must build on ${prevLabel})`,
			`Follow-up ${i + 1} email body:`,
			String(followUpBodies[i] || '').trim()
		);
	}

	const aiText = await callDeepSeekText({
		prompt: promptLines.join('\n'),
		requestId: `${requestId}_subjects`,
	});
	const lines = normalizeNewlines(aiText)
		.split('\n')
		.map((l) => normalizeSubjectLine(l))
		.filter(Boolean);
	return lines;
}

function parseHeaderLine(line) {
	const s = String(line || '').trim();
	if (!s) return null;

	const withType = /^Type:\s*(.+?)\s*\|\s*Subject:\s*(.*)$/i.exec(s);
	if (withType) {
		return {
			type: String(withType[1] || '').trim(),
			subject: String(withType[2] || '').trim(),
		};
	}

	const subjectOnly = /^Subject:\s*(.*)$/i.exec(s);
	if (subjectOnly) {
		return {
			type: '',
			subject: String(subjectOnly[1] || '').trim(),
		};
	}

	return null;
}

function parseEmailsByHeaders(text) {
	const raw = String(text || '').replace(/\r\n/g, '\n').trim();
	if (!raw) return [];

	const lines = raw.split('\n');
	const emails = [];
	let current = null;

	function pushCurrent() {
		if (!current) return;
		const subject = normalizeSubjectLine(String(current.subject || '').trim());
		const type = String(current.type || '').trim();
		const email = String(current.bodyLines.join('\n') || '').trim();
		if (subject || email) emails.push({ type, subject, email });
	}

	for (const line of lines) {
		const trimmed = String(line || '').trim();
		const header = parseHeaderLine(trimmed);
		if (header) {
			pushCurrent();
			current = { type: header.type, subject: header.subject, bodyLines: [] };
			continue;
		}

		if (current && isBlank(current.type) && /^Type:\s*/i.test(trimmed) && !/\|\s*Subject:\s*/i.test(trimmed)) {
			current.type = trimmed.replace(/^Type:\s*/i, '').trim();
			continue;
		}
		if (!current) {
			current = { type: '', subject: '', bodyLines: [] };
		}
		current.bodyLines.push(line);
	}

	pushCurrent();
	return emails;
}

function splitByGreeting(text, maxEmails) {
	const raw = String(text || '').replace(/\r\n/g, '\n').trim();
	if (!raw) return [];

	const lines = raw.split('\n');
	const startIdxs = [];
	for (let i = 0; i < lines.length; i++) {
		const line = String(lines[i] || '').trim();
		if (!line) continue;
		// Prompt forces emails to begin with "Hi <name>," or "Hi,".
		if (/^Hi(\s+[^,\n]{1,40})?,\s*$/i.test(line)) {
			startIdxs.push(i);
		}
	}

	// Must have at least 2 greetings to split (initial + follow-ups).
	if (startIdxs.length < 2) return [];

	// Use the first greeting as the initial start; every subsequent greeting starts a new email.
	const starts = startIdxs;
	const segments = [];
	for (let s = 0; s < starts.length; s++) {
		const start = starts[s];
		const end = s + 1 < starts.length ? starts[s + 1] : lines.length;
		const seg = lines.slice(start, end).join('\n').trim();
		if (seg) segments.push(seg);
	}

	if (!Number.isFinite(maxEmails) || maxEmails <= 0) return segments;
	if (segments.length <= maxEmails) return segments;
	// Merge any extra segments into the last expected one so we don't lose text.
	const head = segments.slice(0, maxEmails - 1);
	const tail = segments.slice(maxEmails - 1).join('\n\n').trim();
	return [...head, tail].filter(Boolean);
}

function parseEmails(text, options = {}) {
	const expectedFollowUps = Number(options.expectedFollowUps || 0);
	const maxEmails = 1 + (Number.isFinite(expectedFollowUps) ? Math.max(0, expectedFollowUps) : 0);

	const byHeaders = parseEmailsByHeaders(text);
	if (byHeaders.length >= 2) return byHeaders;
	if (byHeaders.length === 1 && expectedFollowUps <= 0) return byHeaders;

	// Fallback: if the model omits "Subject:" headers, split by repeated greeting lines.
	const segments = splitByGreeting(text, maxEmails);
	if (segments.length >= 2) {
		return segments.map((seg, idx) => ({
			type: idx === 0 ? 'Initial' : `Follow-up ${idx}`,
			subject: '',
			email: seg,
		}));
	}

	return byHeaders;
}

function countWords(text) {
	const s = String(text || '').trim();
	if (!s) return 0;
	return s.split(/\s+/).filter(Boolean).length;
}

function formatEmailsForContext(emails) {
	return emails
		.map((e, idx) => {
			const subject = String(e?.subject || '').trim();
			const body = String(e?.email || '').trim();
			const label = idx === 0 ? 'Initial' : `Follow-up ${idx}`;
			return [`${label} subject: ${subject || '(missing)'}`, `${label} body:\n${body}`].join('\n');
		})
		.join('\n\n');
}

function isIncompleteEmailBlock(e) {
	if (!e) return true;
	return isBlank(String(e.subject || '').trim()) || isBlank(String(e.email || '').trim());
}

async function generateMissingFollowUps({
	activitySummary,
	jobSettings,
	copyLength,
	recipientFirstName,
	company,
	callToAction,
	valueProp,
	previousEmails,
	startIndex,
	missingCount,
	requestId,
}) {
	const tone = String(jobSettings?.tone || '').trim();
	const toneGuidance = getToneGuidance(tone);
	const missingFrom = startIndex;
	const missingTo = startIndex + missingCount - 1;

	const promptLines = [
		'You are an experienced B2B email copywriter.',
		'',
		`Task: Generate follow-up emails ${missingFrom} through ${missingTo} for a cold outreach sequence.`,
		'You MUST build on the previous emails below and keep continuity.',
		'',
		'Rules (follow exactly):',
		`- Tone: ${tone}. Tone guidance: ${toneGuidance}.`,
		`- Follow-up count to generate NOW: ${missingCount} (only these follow-ups; do not output the initial email).`,
		'- Each follow-up must be shorter than the previous email and slightly more direct than the previous one.',
		`- Length targets: Initial ≈ ${copyLength} words. Follow-up 1 ≈ 75%, Follow-up 2 ≈ 60%, Follow-up 3 ≈ 45%, Follow-up 4 ≈ 35%.`,
		'- Provide ONE new insight/suggestion per follow-up (do not just repeat the offer).',
		'- Use ONE CTA line; low-friction; at most one question; no extra questions elsewhere.',
		'- No signatures, no separators (no --- or ***), no sign-offs (no Best, / Regards,).',
		'',
		'Recipient + context:',
		`- First name: ${String(recipientFirstName || '').trim()}`,
		`- Company: ${String(company || '').trim()}`,
		`- Context (only source):\n${String(activitySummary || '').trim()}`,
		'',
		'Offer:',
		`- Value proposition: ${String(valueProp || '').trim()}`,
		`- Call-to-action: ${String(callToAction || '').trim()}`,
		'',
		'Previous emails (do not repeat them verbatim):',
		formatEmailsForContext(previousEmails),
		'',
		'Output format:',
		'- Plain text only.',
		'- For EACH follow-up, begin with: Subject: <subject text>',
		'- Then a blank line, then the email body.',
		'- Separate each follow-up with a blank line.',
	];

	const aiText = await callDeepSeekText({
		prompt: promptLines.join('\n'),
		requestId: `${requestId}_missing_followups_${missingFrom}_${missingTo}`,
	});
	const parsed = parseEmails(aiText, { expectedFollowUps: missingCount });
	// The model might still label these as Initial; take the first N bodies we can.
	return parsed
		.map((e, idx) => ({
			type: `Follow-up ${missingFrom + idx}`,
			subject: String(e?.subject || '').trim(),
			email: cleanEmailBody(String(e?.email || '').trim()),
		}))
		.filter((e) => !isBlank(e.email) || !isBlank(e.subject))
		.slice(0, missingCount);
}

async function repairIncompleteFollowUpsOnce({
	activitySummary,
	jobSettings,
	copyLength,
	prospect,
	initial,
	followUps,
	desiredFollowUps,
	requestId,
}) {
	if (!desiredFollowUps || desiredFollowUps <= 0) return followUps;

	const repaired = [...followUps];
	for (let i = 0; i < desiredFollowUps; i++) {
		const current = repaired[i];
		if (!isIncompleteEmailBlock(current)) continue;

		const previousEmails = [
			{ subject: String(initial.subject || '').trim(), email: String(initial.email || '').trim() },
			...repaired
				.slice(0, i)
				.map((fu) => ({ subject: String(fu?.subject || '').trim(), email: String(fu?.email || '').trim() })),
		];

		const generated = await generateMissingFollowUps({
			activitySummary,
			jobSettings,
			copyLength,
			recipientFirstName: String(prospect.first_name || '').trim(),
			company: String(prospect.company || '').trim(),
			callToAction: String(jobSettings.callToAction || '').trim(),
			valueProp: String(jobSettings.valueProp || '').trim(),
			previousEmails,
			startIndex: i + 1,
			missingCount: 1,
			requestId: `${requestId}_repair_followup_${i + 1}`,
		});

		if (generated && generated[0] && !isBlank(String(generated[0].email || '').trim())) {
			repaired[i] = {
				type: `Follow-up ${i + 1}`,
				subject: String(generated[0].subject || '').trim(),
				email: cleanEmailBody(String(generated[0].email || '').trim()),
			};
		}
	}

	return repaired.slice(0, desiredFollowUps);
}

async function processProspectRow(prospectId) {
	const db = await getDb();
	const prospect = await db.get('SELECT * FROM prospects WHERE id = ?', prospectId);
	if (!prospect) return;
	if (prospect.status === 'completed') return;

	const job = await db.get('SELECT id, status, settings_json FROM jobs WHERE id = ?', prospect.job_id);
	if (!job) return;
	if (String(job.status || '').toLowerCase() === 'paused') return;
	if (String(job.status || '').toLowerCase() === 'completed') return;
	let jobSettings = null;
	try {
		jobSettings = job && job.settings_json ? JSON.parse(job.settings_json) : null;
	} catch {
		jobSettings = null;
	}

	await db.run(
		"UPDATE prospects SET status = 'running', error = NULL, updated_at = datetime('now') WHERE id = ?",
		prospectId
	);

	try {
		// Bulk Creator requires settings_json. Always use the bulk prompt template.
		if (!jobSettings) {
			throw new Error('Missing job settings (settings_json). Please restart this job from the Bulk Creator.');
		}

			const copyLength = mapCopyLength(jobSettings.length, jobSettings.customLength);
			const followUpCount = Number(jobSettings.followUpCount || 0);

			const activityContext = String(prospect.activity_context || '').trim();
			const activityUrl = String(prospect.website || '').trim();
			let urlSummary = '';
			let urlScrapeFailed = false;
			if (!isBlank(activityUrl)) {
				try {
					urlSummary = await scrapeUrlRaw(activityUrl);
				} catch {
					urlSummary = '';
					urlScrapeFailed = true;
				}
			}
			if (!isBlank(urlSummary) && looksLikeUnreachableOrParkedPage(urlSummary)) {
				urlSummary = '';
				urlScrapeFailed = true;
			}

			const activitySummary = [activityContext, urlSummary].filter(Boolean).join('\n\n').trim();
			if (isBlank(activitySummary)) {
				// If the user provided a URL but it failed to scrape (DNS/unreachable/parked),
				// keep the row in the output with a clear placeholder message.
				if (!isBlank(activityUrl) && urlScrapeFailed && isBlank(activityContext)) {
					const initial = {
						subject: 'Context unavailable',
						email: 'Not able to check personalized context.',
						type: 'Initial',
					};
					await db.run(
						"UPDATE prospects SET status='completed', error=NULL, scraped_content=?, subject=?, opening_line=?, email_body=?, cta=?, followups_json=?, updated_at=datetime('now') WHERE id=?",
						'',
						String(initial.subject || '').trim(),
						'',
						String(initial.email || '').trim(),
						'',
						JSON.stringify([]),
						prospectId
					);

					await db.run(
						"UPDATE jobs SET processed_rows = processed_rows + 1 WHERE id = ?",
						prospect.job_id
					);
					return;
				}

				throw new Error('Missing activity context (URL unreachable/expired and no Activity Context provided)');
			}

			if (config.logActivityContext) {
				// eslint-disable-next-line no-console
				console.log(
					`[bulk][job_${prospect.job_id}_row_${prospect.row_index}] activity_text_or_URL_content_summary:\n${truncateForLog(
						activitySummary,
						config.logActivityContextMaxChars
					)}`
				);

				if (!config.logBulkPrompt && !didLogBulkPromptHint) {
					didLogBulkPromptHint = true;
					// eslint-disable-next-line no-console
					console.log(
						`[bulk] Prompt logging is OFF. Enable it with LOG_BULK_PROMPT=1 (optionally set LOG_BULK_PROMPT_MAX_CHARS).`
					);
				}
			}

			const prompt = fillTemplate(COLD_EMAIL_BULK_PROMPT_WITH_FOLLOW_UP_TEMPLATE, {
				copy_length: String(copyLength),
				follow_up_count: String(Number.isFinite(followUpCount) ? followUpCount : 0),
				follow_up_prompts: String(jobSettings.followUpPrompts || '').trim(),
				tone_type: String(jobSettings.tone || '').trim(),
				tone_guidance: getToneGuidance(jobSettings.tone),
				recipient_first_name: String(prospect.first_name || '').trim(),
				recipient_job_title: '',
				recipient_company_name: String(prospect.company || '').trim(),
				activity_text_or_URL_content_summary: activitySummary,
				value_proposition: String(jobSettings.valueProp || '').trim(),
				call_to_action: String(jobSettings.callToAction || '').trim(),
				subject: String(jobSettings.subject || '').trim(),
				additional_instructions: String(jobSettings.instructions || '').trim(),
			});

			if (config.logBulkPrompt) {
				// eslint-disable-next-line no-console
				console.log(
					`[bulk][job_${prospect.job_id}_row_${prospect.row_index}] prompt:\n${truncateForLog(
						prompt,
						config.logBulkPromptMaxChars
					)}`
				);
			}

			const aiText = await callDeepSeekText({
				prompt,
				requestId: `job_${prospect.job_id}_row_${prospect.row_index}`,
			});
			const emails = parseEmails(aiText, { expectedFollowUps: followUpCount });
			const initial = emails[0] || { subject: '', email: String(aiText || '').trim(), type: 'Initial' };
			initial.subject = normalizeSubjectLine(String(initial.subject || '').trim());
			if (isBlank(initial.subject) && !isBlank(jobSettings.subject)) {
				initial.subject = normalizeSubjectLine(String(jobSettings.subject || '').trim());
			}
			let followUps = emails.length > 1 ? emails.slice(1).map((e, idx) => ({
				type: String(e.type || '').trim() || `Follow-up ${idx + 1}`,
				subject: normalizeSubjectLine(String(e.subject || '').trim()),
				email: String(e.email || '').trim(),
			})) : [];

			// Sanitize bodies to avoid leaking separators/signatures into email content.
			initial.email = cleanEmailBody(String(initial.email || '').trim());
			followUps = followUps.map((fu) => ({
				...fu,
				subject: normalizeSubjectLine(String(fu.subject || '').trim()),
				email: cleanEmailBody(String(fu.email || '').trim()),
			}));

			// Ensure we always have subjects (initial + follow-ups). Use AI only if missing.
			const missingInitialSubject = isBlank(initial.subject);
			const missingFollowUpSubjectCount = followUps.filter((fu) => isBlank(fu.subject)).length;
			if (missingInitialSubject || missingFollowUpSubjectCount > 0) {
				const desiredFollowUps = Number.isFinite(followUpCount) ? Math.max(0, followUpCount) : 0;
				const followUpBodies = [];
				for (let i = 0; i < desiredFollowUps; i++) {
					followUpBodies.push(String(followUps[i]?.email || '').trim());
				}
				const subjects = await generateMissingSubjects({
					activitySummary,
					jobSettings,
					company: String(prospect.company || '').trim(),
					initialSubject: String(initial.subject || '').trim(),
					initialBody: String(initial.email || '').trim(),
					followUpBodies,
					requestId: `job_${prospect.job_id}_row_${prospect.row_index}`,
				});
				// subjects[0] => initial, then follow-ups
				if (isBlank(initial.subject) && subjects[0]) initial.subject = normalizeSubjectLine(subjects[0]);
				for (let i = 0; i < desiredFollowUps; i++) {
					if (!followUps[i]) break;
					if (isBlank(followUps[i].subject) && subjects[i + 1]) {
						followUps[i].subject = normalizeSubjectLine(subjects[i + 1]);
					}
				}
			}

			// Ensure we always return exactly the requested number of follow-ups.
			const desiredFollowUps = Number.isFinite(followUpCount) ? Math.max(0, followUpCount) : 0;
			if (followUps.length > desiredFollowUps) {
				followUps = followUps.slice(0, desiredFollowUps);
			}
			if (desiredFollowUps > 0 && followUps.length < desiredFollowUps) {
				const missingCount = desiredFollowUps - followUps.length;
				const startIndex = followUps.length + 1;
				const previousEmails = [
					{ subject: String(initial.subject || '').trim(), email: String(initial.email || '').trim() },
					...followUps.map((fu) => ({ subject: String(fu.subject || '').trim(), email: String(fu.email || '').trim() })),
				];
				const missing = await generateMissingFollowUps({
					activitySummary,
					jobSettings,
					copyLength,
					recipientFirstName: String(prospect.first_name || '').trim(),
					company: String(prospect.company || '').trim(),
					callToAction: String(jobSettings.callToAction || '').trim(),
					valueProp: String(jobSettings.valueProp || '').trim(),
					previousEmails,
					startIndex,
					missingCount,
					requestId: `job_${prospect.job_id}_row_${prospect.row_index}`,
				});
				followUps = [...followUps, ...missing]
					.map((fu, idx) => ({
						type: `Follow-up ${idx + 1}`,
						subject: normalizeSubjectLine(String(fu.subject || '').trim()),
						email: cleanEmailBody(String(fu.email || '').trim()),
					}))
					.slice(0, desiredFollowUps);
			}

			// Retry once: if any follow-up is missing a subject OR body, regenerate only that follow-up.
			followUps = await repairIncompleteFollowUpsOnce({
				activitySummary,
				jobSettings,
				copyLength,
				prospect,
				initial,
				followUps,
				desiredFollowUps,
				requestId: `job_${prospect.job_id}_row_${prospect.row_index}`,
			});

			// After repairs, ensure we have subjects (best-effort) for any regenerated follow-ups.
			const missingFollowUpSubjectCountAfterRepair = followUps.filter((fu) => isBlank(fu?.subject)).length;
			if (missingFollowUpSubjectCountAfterRepair > 0) {
				const followUpBodies = [];
				for (let i = 0; i < desiredFollowUps; i++) {
					followUpBodies.push(String(followUps[i]?.email || '').trim());
				}
				const subjects = await generateMissingSubjects({
					activitySummary,
					jobSettings,
					company: String(prospect.company || '').trim(),
					initialSubject: String(initial.subject || '').trim(),
					initialBody: String(initial.email || '').trim(),
					followUpBodies,
					requestId: `job_${prospect.job_id}_row_${prospect.row_index}`,
				});
				for (let i = 0; i < desiredFollowUps; i++) {
					if (!followUps[i]) break;
					if (isBlank(followUps[i].subject) && subjects[i + 1]) {
						followUps[i].subject = subjects[i + 1];
					}
				}
			}

			// Final guard: keep follow-ups shorter than the initial (best-effort).
			const initialWords = countWords(initial.email);
			if (initialWords > 0) {
				followUps = followUps.map((fu) => {
					const w = countWords(fu.email);
					if (w > 0 && w >= initialWords) {
						// Soft trim: drop trailing paragraphs if it gets too long.
						const parts = normalizeNewlines(fu.email).split(/\n\n+/);
						while (parts.length > 1 && countWords(parts.join('\n\n')) >= initialWords) {
							parts.pop();
						}
						return { ...fu, email: parts.join('\n\n').trim() };
					}
					return fu;
				});
			}

			// Hard guarantee: enforce paragraph counts regardless of model drift.
			initial.email = enforceEmailParagraphs(String(initial.email || '').trim(), 3);
			followUps = followUps.map((fu, idx) => ({
				...fu,
				email: enforceEmailParagraphs(
					String(fu.email || '').trim(),
					followUpTargetParagraphs(idx + 1, desiredFollowUps)
				),
			}));

			// Final subject normalization (hard guarantee: no Re:/Fwd: prefixes leak through).
			initial.subject = normalizeSubjectLine(String(initial.subject || '').trim());
			followUps = followUps.map((fu) => ({
				...fu,
				subject: normalizeSubjectLine(String(fu.subject || '').trim()),
			}));

			await db.run(
				"UPDATE prospects SET status='completed', error=NULL, scraped_content=?, subject=?, opening_line=?, email_body=?, cta=?, followups_json=?, updated_at=datetime('now') WHERE id=?",
				activitySummary,
				String(initial.subject || '').trim(),
				'',
				String(initial.email || '').trim(),
				'',
				JSON.stringify(followUps),
				prospectId
			);

		await db.run(
			"UPDATE jobs SET processed_rows = processed_rows + 1 WHERE id = ?",
			prospect.job_id
		);
	} catch (err) {
		await db.run(
			"UPDATE prospects SET status='failed', error=?, updated_at=datetime('now') WHERE id=?",
			String(err.message || err),
			prospectId
		);
		await db.run(
			"UPDATE jobs SET processed_rows = processed_rows + 1, error_count = error_count + 1 WHERE id = ?",
			prospect.job_id
		);
	}

	// Finalize job if done
	const row = await db.get('SELECT total_rows, processed_rows FROM jobs WHERE id = ?', prospect.job_id);
	if (row && row.total_rows > 0 && row.processed_rows >= row.total_rows) {
		await db.run(
			"UPDATE jobs SET status='completed', finished_at=datetime('now') WHERE id=? AND status <> 'completed'",
			prospect.job_id
		);
	}
}

async function enqueueJob(jobId) {
	const db = await getDb();
	const job = await db.get('SELECT * FROM jobs WHERE id = ?', jobId);
	if (!job) return;
	if (String(job.status || '').toLowerCase() === 'paused') return;

	await db.run(
		"UPDATE jobs SET status='running', started_at=COALESCE(started_at, datetime('now')) WHERE id=? AND status IN ('queued','running')",
		jobId
	);

	const pending = await db.all(
		"SELECT id FROM prospects WHERE job_id = ? AND status IN ('queued') ORDER BY row_index ASC",
		jobId
	);

	const q = getQueue();
	for (const p of pending) {
		q.add(() => processProspectRow(p.id));
	}
}

async function startJobWorker() {
	if (started) return;
	started = true;

	getQueue();

	const db = await getDb();
	const activeJobs = await db.all("SELECT id FROM jobs WHERE status IN ('queued','running')");
	for (const j of activeJobs) {
		enqueueJob(j.id);
	}
}

module.exports = { startJobWorker, enqueueJob };
