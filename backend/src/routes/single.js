const express = require('express');
const { z } = require('zod');

const { asyncHandler } = require('../util/async-handler');
const { HttpError } = require('../util/http-error');
const { COLD_EMAIL_PROMPT_WITH_FOLLOW_UP_TEMPLATE } = require('../ai/prompt');
const { getToneGuidance } = require('../ai/toneGuide');
const { scrapeUrlRaw } = require('../scrape/scrapeUrlRaw');
const { callDeepSeekText } = require('../ai/deepseek');
const { normalizeWebsiteInput } = require('../util/website');

const singleRouter = express.Router();

function isBlank(v) {
	return String(v || '').trim().length === 0;
}

function mapCopyLength(length, customLength) {
	const l = String(length || '').trim();
	if (l === 'Custom') {
		const n = Number(customLength);
		if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, 'Custom word count must be a positive number', { expose: true });
		return String(Math.round(n));
	}
	if (l.startsWith('Short')) return '65';
	if (l.startsWith('Medium')) return '100';
	if (l.startsWith('Long')) return '150';
	// fallback
	return '100';
}

function fillTemplate(template, values) {
	let out = String(template);
	for (const [key, value] of Object.entries(values)) {
		out = out.split(`{${key}}`).join(String(value ?? ''));
	}
	return out;
}

function parseHeaderLine(line) {
	const s = String(line || '').trim();
	if (!s) return null;

	// Preferred format: Type: <...> | Subject: <...>
	const withType = /^Type:\s*(.+?)\s*\|\s*Subject:\s*(.*)$/i.exec(s);
	if (withType) {
		return {
			type: String(withType[1] || '').trim(),
			subject: String(withType[2] || '').trim(),
		};
	}

	// Legacy format: Subject: <...>
	const subjectOnly = /^Subject:\s*(.*)$/i.exec(s);
	if (subjectOnly) {
		return {
			type: '',
			subject: String(subjectOnly[1] || '').trim(),
		};
	}

	return null;
}

function parseSubjectAndBody(text) {
	const raw = String(text || '').replace(/\r\n/g, '\n').trim();
	if (!raw) return { subject: '', email: '' };

	const lines = raw.split('\n');
	const firstLine = String(lines[0] || '').trim();
	const header = parseHeaderLine(firstLine);
	if (header) {
		let startIdx = 1;
		// Back-compat: if the next line is a standalone Type: ... (older prompt), skip it.
		const maybeTypeLine = String(lines[1] || '').trim();
		if (/^Type:\s*/i.test(maybeTypeLine) && !/\|\s*Subject:\s*/i.test(maybeTypeLine)) {
			startIdx = 2;
		}
		const body = lines.slice(startIdx).join('\n').trim();
		return { subject: header.subject, email: body, type: header.type };
	}

	// fallback if model didn't follow the format
	return { subject: '', email: raw, type: '' };
}

function parseEmails(text) {
	const raw = String(text || '').replace(/\r\n/g, '\n').trim();
	if (!raw) return [];

	const lines = raw.split('\n');
	const emails = [];
	let current = null;

	function pushCurrent() {
		if (!current) return;
		const subject = String(current.subject || '').trim();
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

		// Back-compat: older prompt had Type: ... on the second line.
		if (current && isBlank(current.type) && /^Type:\s*/i.test(trimmed) && !/\|\s*Subject:\s*/i.test(trimmed)) {
			current.type = trimmed.replace(/^Type:\s*/i, '').trim();
			continue;
		}
		if (!current) {
			// If the model didn't start with Subject, treat entire content as body.
			current = { type: '', subject: '', bodyLines: [] };
		}
		current.bodyLines.push(line);
	}

	pushCurrent();
	return emails;
}

function formatEmails(emails) {
	const list = Array.isArray(emails) ? emails : [];
	return list
		.map((e, idx) => {
			const subject = String(e?.subject || '').trim();
			const body = String(e?.email || '').trim();
			const fallbackType = idx === 0 ? 'Initial' : `Follow-up ${idx}`;
			const type = String(e?.type || '').trim() || fallbackType;
			const header = `Type: ${type} | Subject: ${subject || ''}`.trimEnd();
			return `${header}\n\n${body}`.trim();
		})
		.filter(Boolean)
		.join('\n\n');
}

function parseFollowUpCount(value) {
	const n = Number(String(value ?? '').trim() || 0);
	if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'Follow-up count must be a number >= 0', { expose: true });
	return Math.min(10, Math.floor(n));
}

function isHttpUrl(value) {
	const s = String(value || '').trim();
	if (!s) return false;
	try {
		const u = new URL(s);
		return u.protocol === 'http:' || u.protocol === 'https:';
	} catch {
		return false;
	}
}

function looksLikeSingleUrl(value) {
	const s = String(value || '').trim();
	if (!s) return false;
	// If it contains whitespace/newlines, treat it as pasted context.
	if (/\s/.test(s)) return false;
	// Quick heuristic: domains/urls usually contain a dot.
	return s.includes('.');
}

singleRouter.post(
	'/generate',
	asyncHandler(async (req, res) => {
		const schema = z
			.object({
				recipientName: z.string().default(''),
				recipientRole: z.string().default(''),
				companyName: z.string().default(''),
				companyUrl: z.string().default(''),
				activityText: z.string().default(''),
				valueProp: z.string().default(''),
				// legacy / optional: previously required, now inferred from context
				painPoint: z.string().optional(),
				callToAction: z.string().default(''),
				subject: z.string().default(''),
				followUpCount: z.union([z.string(), z.number()]).optional(),
				followUpPrompts: z.string().default(''),
				tone: z.string().default(''),
				length: z.string().default(''),
				customLength: z.union([z.string(), z.number()]).optional(),
				instructions: z.string().default(''),
				senderName: z.string().default(''),
				senderTitle: z.string().default(''),
				senderCompany: z.string().default(''),
			})
			.strict();

		const data = schema.parse(req.body || {});

		// Required fields aligned with /single UI
		if (isBlank(data.recipientName)) throw new HttpError(400, 'Recipient first name is required', { expose: true });
		if (isBlank(data.companyName)) throw new HttpError(400, 'Company name is required', { expose: true });
		if (isBlank(data.callToAction)) throw new HttpError(400, 'Call to action is required', { expose: true });
		if (isBlank(data.tone)) throw new HttpError(400, 'Tone is required', { expose: true });
		if (isBlank(data.senderName) || isBlank(data.senderTitle) || isBlank(data.senderCompany)) {
			throw new HttpError(400, 'Sender name, title, and company are required', { expose: true });
		}

		// Frontend now uses a single field that can contain either a URL or pasted context.
		// Keep legacy support for activityText if an older client still sends it.
		const rawFromTextField = String(data.activityText || '').trim();
		const rawFromUrlField = String(data.companyUrl || '').trim();

		let urlToScrape = '';
		let pastedContextFromUrlField = '';
		if (!isBlank(rawFromUrlField) && looksLikeSingleUrl(rawFromUrlField)) {
			if (isHttpUrl(rawFromUrlField)) {
				urlToScrape = rawFromUrlField;
			} else {
				const normalized = normalizeWebsiteInput(rawFromUrlField);
				urlToScrape = normalized.ok && normalized.homepageUrl ? normalized.homepageUrl : '';
			}
		}
		if (isBlank(urlToScrape)) {
			pastedContextFromUrlField = rawFromUrlField;
		}

		if (isBlank(rawFromTextField) && isBlank(pastedContextFromUrlField) && isBlank(urlToScrape)) {
			throw new HttpError(400, 'Please add activity context (URL or pasted text).', { expose: true });
		}

		let urlSummary = '';
		if (!isBlank(urlToScrape)) {
			urlSummary = await scrapeUrlRaw(urlToScrape);
		}

		const activitySummary = [rawFromTextField, pastedContextFromUrlField, String(urlSummary || '').trim()]
			.filter(Boolean)
			.join('\n\n');

		if (isBlank(activitySummary)) {
			throw new HttpError(422, 'Not able to read the content for personalization. Please paste activity context instead.', {
				expose: true,
			});
		}

		const copyLength = mapCopyLength(data.length, data.customLength);
		const followUpCount = parseFollowUpCount(data.followUpCount);

		const prompt = fillTemplate(COLD_EMAIL_PROMPT_WITH_FOLLOW_UP_TEMPLATE, {
			copy_length: copyLength,
			follow_up_count: String(followUpCount),
			follow_up_prompts: String(data.followUpPrompts || '').trim(),
			tone_type: String(data.tone || '').trim(),
			tone_guidance: getToneGuidance(data.tone),
			recipient_first_name: String(data.recipientName || '').trim(),
			recipient_job_title: String(data.recipientRole || '').trim(),
			recipient_company_name: String(data.companyName || '').trim(),
			activity_text_or_URL_content_summary: activitySummary,
			value_proposition: String(data.valueProp || '').trim(),
			call_to_action: String(data.callToAction || '').trim(),
			sender_name: String(data.senderName || '').trim(),
			sender_title: String(data.senderTitle || '').trim(),
			sender_company: String(data.senderCompany || '').trim(),
			subject: String(data.subject || '').trim(),
			additional_instructions: String(data.instructions || '').trim(),
		});

		// Debug: print the exact prompt being sent to the model.
		// eslint-disable-next-line no-console
		console.log(
			[
				'\n================ SINGLE GENERATE PROMPT (START) ================',
				prompt,
				'================ SINGLE GENERATE PROMPT (END) ==================\n',
			].join('\n')
		);

		const aiText = await callDeepSeekText({ prompt, requestId: 'single_generate' });
		const emails = parseEmails(aiText);
		const parsed = emails.length ? emails[0] : parseSubjectAndBody(aiText);
		const formattedText = emails.length
			? formatEmails(emails)
			: formatEmails([
				{
					type: String(parsed?.type || '').trim() || 'Initial',
					subject: String(parsed?.subject || '').trim() || String(data.subject || '').trim(),
					email: String(parsed?.email || '').trim(),
				},
			]);

		const subject = String(parsed.subject || '').trim() || String(data.subject || '').trim();
		const email = String(parsed.email || '').trim();
		if (isBlank(email)) {
			throw new HttpError(502, 'AI returned an empty email body. Please try again.', { expose: true });
		}

		res.json({
			subject,
			email,
			emails: emails.length ? emails : [{ type: 'Initial', subject, email }],
			text: formattedText,
		});
	})
);

module.exports = { singleRouter };
