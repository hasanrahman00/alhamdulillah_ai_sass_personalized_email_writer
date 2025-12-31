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
			if (!isBlank(activityUrl)) {
				try {
					urlSummary = await scrapeUrlRaw(activityUrl);
				} catch {
					urlSummary = '';
				}
			}

			const activitySummary = [activityContext, urlSummary].filter(Boolean).join('\n\n').trim();
			if (isBlank(activitySummary)) {
				throw new Error('Missing activity context (URL or Activity Context)');
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
			const emails = parseEmails(aiText);
			const initial = emails[0] || { subject: '', email: String(aiText || '').trim(), type: 'Initial' };
			const followUps = emails.length > 1 ? emails.slice(1).map((e, idx) => ({
				type: String(e.type || '').trim() || `Follow-up ${idx + 1}`,
				subject: String(e.subject || '').trim(),
				email: String(e.email || '').trim(),
			})) : [];

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
