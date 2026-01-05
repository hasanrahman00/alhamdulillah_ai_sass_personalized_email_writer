const fs = require('fs');

const express = require('express');
const csvParser = require('csv-parser');
const { Parser } = require('@json2csv/plainjs');
const { z } = require('zod');

const { asyncHandler } = require('../util/async-handler');
const { HttpError } = require('../util/http-error');
const { getDb } = require('../db');
const { enqueueJob } = require('../jobs/worker');
const { normalizeWebsiteInput } = require('../util/website');

const jobsRouter = express.Router();

const DEFAULT_USER_ID = 1;

function withHttps(url) {
	const raw = String(url || '').trim();
	if (!raw) return '';
	if (/^https?:\/\//i.test(raw)) return raw;
	return `https://${raw}`;
}

function normalizeHttpUrlPreservePath(rawUrl) {
	const raw = String(rawUrl || '').trim();
	if (!raw) return '';
	if (/^(mailto:|tel:|javascript:|data:)/i.test(raw)) return '';
	const candidate = withHttps(raw);
	try {
		const u = new URL(candidate);
		if (!(u.protocol === 'http:' || u.protocol === 'https:')) return '';
		return u.toString();
	} catch {
		return '';
	}
}

function isBlank(v) {
	return String(v || '').trim().length === 0;
}

function htmlBreaksToNewlines(text) {
	// Some users/LLMs paste HTML-ish content like "<br><br>".
	// Convert common line-break tags to real newlines so CSV exports and copy/paste
	// preserve paragraphs in plain-text tools.
	return String(text || '').replace(/<br\s*\/?>/gi, '\n');
}

function toLf(text) {
	// Some CSV importers strip/normalize CR (\r) inside fields.
	// Using LF-only inside multiline cells tends to preserve paragraph breaks better.
	return htmlBreaksToNewlines(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function splitParagraphs(text, maxParts = 5) {
	const normalized = toLf(text).trim();
	if (!normalized) return [];
	const parts = normalized
		.split(/\n\s*\n+/)
		.map((p) => p.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim())
		.filter(Boolean);
	if (parts.length <= maxParts) return parts;
	const head = parts.slice(0, maxParts - 1);
	const tail = parts.slice(maxParts - 1).join(' ');
	return [...head, tail];
}

function parseFollowUpCount(value) {
	const n = Number(String(value ?? '').trim() || 0);
	if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'Follow-up count must be a number >= 0', { expose: true });
	return Math.min(10, Math.floor(n));
}

jobsRouter.post(
	'/start',
	asyncHandler(async (req, res) => {
		const schema = z
			.object({
				fileId: z.number().int().positive(),
				valueProp: z.string().default(''),
				callToAction: z.string().default(''),
				subject: z.string().default(''),
				followUpCount: z.union([z.string(), z.number()]).optional(),
				followUpPrompts: z.string().default(''),
				tone: z.string().default(''),
				length: z.string().default(''),
				customLength: z.union([z.string(), z.number()]).optional(),
				instructions: z.string().default(''),
			})
			.strict();
		const data = schema.parse(req.body || {});
		const fileId = data.fileId;

		// Minimal validation (frontend already enforces these).
		if (isBlank(data.valueProp)) throw new HttpError(400, 'Offer summary is required', { expose: true });
		if (isBlank(data.callToAction)) throw new HttpError(400, 'Call to action is required', { expose: true });
		if (isBlank(data.tone)) throw new HttpError(400, 'Tone is required', { expose: true });
		if (isBlank(data.length)) throw new HttpError(400, 'Copy length is required', { expose: true });

		const followUpCount = parseFollowUpCount(data.followUpCount);
		const settings = {
			valueProp: String(data.valueProp || '').trim(),
			callToAction: String(data.callToAction || '').trim(),
			subject: String(data.subject || '').trim(),
			followUpCount,
			followUpPrompts: String(data.followUpPrompts || '').trim(),
			tone: String(data.tone || '').trim(),
			length: String(data.length || '').trim(),
			customLength: String(data.customLength ?? '').trim(),
			instructions: String(data.instructions || '').trim(),
		};

		const db = await getDb();
		const file = await db.get('SELECT * FROM files WHERE id = ? AND user_id = ?', fileId, DEFAULT_USER_ID);
		if (!file) throw new HttpError(404, 'File not found');

		const existing = await db.get(
			"SELECT * FROM jobs WHERE file_id = ? AND user_id = ? AND status IN ('queued','running','paused','completed') ORDER BY id DESC LIMIT 1",
			fileId,
			DEFAULT_USER_ID
		);
		if (existing) {
			return res.json({ job: existing, reused: true });
		}

		const columnMap = JSON.parse(file.column_map_json);

		const jobInsert = await db.run(
			"INSERT INTO jobs (user_id, file_id, settings_json, status, total_rows, processed_rows, error_count, started_at) VALUES (?, ?, ?, 'queued', 0, 0, 0, NULL)",
			DEFAULT_USER_ID,
			fileId,
			JSON.stringify(settings)
		);
		const jobId = jobInsert.lastID;

		let total = 0;
		await db.exec('BEGIN');
		try {
			await new Promise((resolve, reject) => {
				const stream = fs.createReadStream(file.stored_path).pipe(csvParser());

				stream.on('data', (row) => {
					stream.pause();
					(async () => {
						const firstName = columnMap.firstName ? row[columnMap.firstName] : '';
						const lastName = columnMap.lastName ? row[columnMap.lastName] : '';
						const email = columnMap.email ? row[columnMap.email] : '';
						const company = columnMap.company ? row[columnMap.company] : '';
						const websiteRaw = columnMap.website ? row[columnMap.website] : '';
						const activityContext = columnMap.activityContext ? row[columnMap.activityContext] : '';
						const website = normalizeHttpUrlPreservePath(websiteRaw);
						const ourServices = columnMap.ourServices ? row[columnMap.ourServices] : '';

						await db.run(
							`INSERT INTO prospects (
								user_id, file_id, job_id, row_index, status,
								first_name, last_name, email, company, website, activity_context, our_services,
								original_row_json
							) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)` ,
							DEFAULT_USER_ID,
							fileId,
							jobId,
							total,
							String(firstName || ''),
							String(lastName || ''),
							String(email || ''),
							String(company || ''),
							String(website || ''),
							String(activityContext || ''),
							String(ourServices || ''),
							JSON.stringify(row)
						);

						total++;
					})()
						.then(() => stream.resume())
						.catch((err) => {
							stream.destroy(err);
						});
				});

				stream.on('error', (err) => reject(err));
				stream.on('end', () => resolve());
			});

			await db.run('UPDATE jobs SET total_rows = ? WHERE id = ?', total, jobId);
			await db.exec('COMMIT');
		} catch (err) {
			await db.exec('ROLLBACK');
			await db.run("UPDATE jobs SET status='failed', finished_at=datetime('now') WHERE id = ?", jobId);
			throw err;
		}

		// Ensure total_rows is accurate based on what was actually inserted (excludes header).
		// This prevents UI progress from showing an incorrect total when CSV parsing skips blank/invalid lines.
		const counted = await db.get('SELECT COUNT(1) AS c FROM prospects WHERE job_id = ?', jobId);
		const totalRows = Number(counted?.c || 0);
		await db.run('UPDATE jobs SET total_rows = ? WHERE id = ?', totalRows, jobId);

		await enqueueJob(jobId);
		const job = await db.get('SELECT * FROM jobs WHERE id = ?', jobId);
		res.json({ job, reused: false });
	})
);

jobsRouter.get(
	'/',
	asyncHandler(async (req, res) => {
		const db = await getDb();
		const jobs = await db.all(
			'SELECT * FROM jobs WHERE user_id = ? ORDER BY id DESC LIMIT 50',
			DEFAULT_USER_ID
		);
		res.json({ jobs });
	})
);

jobsRouter.get(
	'/:jobId',
	asyncHandler(async (req, res) => {
		const jobId = Number(req.params.jobId);
		const db = await getDb();
		const job = await db.get('SELECT * FROM jobs WHERE id = ? AND user_id = ?', jobId, DEFAULT_USER_ID);
		if (!job) throw new HttpError(404, 'Job not found');
		res.json({ job });
	})
);

jobsRouter.post(
	'/:jobId/stop',
	asyncHandler(async (req, res) => {
		const jobId = Number(req.params.jobId);
		const db = await getDb();
		const job = await db.get('SELECT * FROM jobs WHERE id = ? AND user_id = ?', jobId, DEFAULT_USER_ID);
		if (!job) throw new HttpError(404, 'Job not found');

		await db.run(
			"UPDATE jobs SET status='paused' WHERE id = ? AND user_id = ? AND status IN ('queued','running','paused')",
			jobId,
			DEFAULT_USER_ID
		);
		const updated = await db.get('SELECT * FROM jobs WHERE id = ? AND user_id = ?', jobId, DEFAULT_USER_ID);
		res.json({ job: updated });
	})
);

jobsRouter.post(
	'/:jobId/resume',
	asyncHandler(async (req, res) => {
		const jobId = Number(req.params.jobId);
		const db = await getDb();
		const job = await db.get('SELECT * FROM jobs WHERE id = ? AND user_id = ?', jobId, DEFAULT_USER_ID);
		if (!job) throw new HttpError(404, 'Job not found');
		if (String(job.status || '') === 'completed') {
			return res.json({ job });
		}

		await db.run(
			"UPDATE jobs SET status='running', started_at=COALESCE(started_at, datetime('now')) WHERE id = ? AND user_id = ?",
			jobId,
			DEFAULT_USER_ID
		);
		await enqueueJob(jobId);
		const updated = await db.get('SELECT * FROM jobs WHERE id = ? AND user_id = ?', jobId, DEFAULT_USER_ID);
		res.json({ job: updated });
	})
);

jobsRouter.delete(
	'/:jobId',
	asyncHandler(async (req, res) => {
		const jobId = Number(req.params.jobId);
		const db = await getDb();
		const job = await db.get('SELECT * FROM jobs WHERE id = ? AND user_id = ?', jobId, DEFAULT_USER_ID);
		if (!job) throw new HttpError(404, 'Job not found');

		const file = await db.get('SELECT * FROM files WHERE id = ? AND user_id = ?', job.file_id, DEFAULT_USER_ID);

		await db.exec('BEGIN');
		try {
			await db.run('DELETE FROM prospects WHERE job_id = ?', jobId);
			await db.run('DELETE FROM jobs WHERE id = ? AND user_id = ?', jobId, DEFAULT_USER_ID);
			if (file) {
				await db.run('DELETE FROM prospects WHERE file_id = ?', file.id);
				await db.run('DELETE FROM files WHERE id = ? AND user_id = ?', file.id, DEFAULT_USER_ID);
			}
			await db.exec('COMMIT');
		} catch (err) {
			await db.exec('ROLLBACK');
			throw err;
		}

		if (file?.stored_path) {
			try {
				if (fs.existsSync(file.stored_path)) fs.unlinkSync(file.stored_path);
			} catch {
				// Best-effort file cleanup.
			}
		}

		res.json({ ok: true });
	})
);

jobsRouter.get(
	'/:jobId/rows',
	asyncHandler(async (req, res) => {
		const jobId = Number(req.params.jobId);
		const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
		const offset = Math.max(0, Number(req.query.offset || 0));

		const db = await getDb();
		const job = await db.get('SELECT id FROM jobs WHERE id = ? AND user_id = ?', jobId, DEFAULT_USER_ID);
		if (!job) throw new HttpError(404, 'Job not found');

		const rows = await db.all(
			`SELECT row_index, status, error, subject, opening_line, email_body, cta
			 FROM prospects
			 WHERE job_id = ?
			 ORDER BY row_index ASC
			 LIMIT ? OFFSET ?`,
			jobId,
			limit,
			offset
		);

		res.json({ rows, limit, offset });
	})
);

jobsRouter.get(
	'/:jobId/download',
	asyncHandler(async (req, res) => {
		const jobId = Number(req.params.jobId);
		const db = await getDb();
		const job = await db.get('SELECT * FROM jobs WHERE id = ? AND user_id = ?', jobId, DEFAULT_USER_ID);
		if (!job) throw new HttpError(404, 'Job not found');

		const file = await db.get('SELECT * FROM files WHERE id = ? AND user_id = ?', job.file_id, DEFAULT_USER_ID);
		if (!file) throw new HttpError(404, 'File not found');

		const outputs = await db.all(
			'SELECT row_index, first_name, status, error, subject, opening_line, email_body, cta, followups_json FROM prospects WHERE job_id = ? ORDER BY row_index ASC',
			jobId
		);
		const map = new Map(outputs.map((r) => [r.row_index, r]));

		function ensureNamePrefix(openingLine, firstName) {
			const fn = String(firstName || '').trim();
			const ol = String(openingLine || '').trim();
			if (!fn) return ol;
			if (!ol) return `${fn},`;
			const lower = ol.toLowerCase();
			const fnLower = fn.toLowerCase();
			if (lower.startsWith(`${fnLower},`) || lower.startsWith(`${fnLower} `)) return ol;
			return `${fn}, ${ol.replace(/^[,\s]+/, '')}`.trim();
		}

		function buildFullEmail(out) {
			if (!out) return '';
			const status = String(out.status || '').trim().toLowerCase();
			const err = String(out.error || '').trim();
			const openingLine = String(out.opening_line || '').trim();
			const cta = String(out.cta || '').trim();
			const emailBody = String(out.email_body || '').trim();
			if ((status === 'failed' || isBlank(emailBody)) && !isBlank(err)) return err;
			// If the worker stored a full email body (template-based bulk), return it directly.
			if (isBlank(openingLine) && isBlank(cta)) return toLf(emailBody);

			const opening = ensureNamePrefix(openingLine, out.first_name);
			const parts = [opening, emailBody, cta].map((s) => String(s || '').trim()).filter(Boolean);
			return toLf(parts.join('\n\n'));
		}

		const originalHeaders = JSON.parse(file.header_json);
		let followUpCount = 0;
		try {
			const settings = job.settings_json ? JSON.parse(job.settings_json) : null;
			followUpCount = parseFollowUpCount(settings?.followUpCount);
		} catch {
			followUpCount = 0;
		}

		// Output headers are intentionally distinct from common input columns like "subject".
		// NOTE: SMTPGhost uses Liquid; Liquid identifiers cannot start with a number.
		const extraCols = ['first_copy_subject', 'first_copy'];
		for (let i = 1; i <= 4; i++) extraCols.push(`first_copy_p${i}`);

		function followUpMaxParagraphs(i) {
			// 1st + 2nd follow-ups: up to 3 paragraph columns
			if (i === 1 || i === 2) return 3;
			// 3rd follow-up depends on total follow-ups
			if (i === 3) return followUpCount >= 4 ? 3 : 2;
			// 4th follow-up: up to 2 paragraph columns
			if (i === 4) return 2;
			// Any additional follow-ups (if enabled): keep compact
			return 2;
		}

		for (let i = 1; i <= followUpCount; i++) {
			extraCols.push(`followup_${i}_subject`, `followup_${i}_email_body`);
			const maxP = followUpMaxParagraphs(i);
			for (let p = 1; p <= maxP; p++) extraCols.push(`followup_${i}_email_body_p${p}`);
		}
		const fields = Array.from(new Set([...originalHeaders, ...extraCols]));

		const rows = [];
		let idx = 0;
		await new Promise((resolve, reject) => {
			fs.createReadStream(file.stored_path)
				.pipe(csvParser())
				.on('data', (row) => {
					const out = map.get(idx);
					idx++;
					let followUps = [];
					try {
						followUps = out?.followups_json ? JSON.parse(out.followups_json) : [];
					} catch {
						followUps = [];
					}

					const followUpCols = {};
					for (let i = 1; i <= followUpCount; i++) {
						const fu = followUps?.[i - 1] || {};
						followUpCols[`followup_${i}_subject`] = String(fu?.subject || '').trim();
						const fuBody = String(fu?.email || '').trim();
						followUpCols[`followup_${i}_email_body`] = toLf(fuBody);
						const maxP = followUpMaxParagraphs(i);
						const fuParts = splitParagraphs(fuBody, maxP);
						for (let p = 1; p <= maxP; p++) {
							followUpCols[`followup_${i}_email_body_p${p}`] = fuParts[p - 1] || '';
						}
					}

					const fullEmail = buildFullEmail(out);
					const parts = splitParagraphs(fullEmail, 4);
					const initialParaCols = {};
					for (let p = 1; p <= 4; p++) {
						initialParaCols[`first_copy_p${p}`] = parts[p - 1] || '';
					}

					rows.push({
						...row,
						'first_copy_subject':
							out?.subject ||
							(String(out?.status || '').trim().toLowerCase() === 'failed' ? 'Context unavailable' : ''),
						'first_copy': fullEmail,
						...initialParaCols,
						...followUpCols,
					});
				})
				.on('error', (err) => reject(err))
				.on('end', () => resolve());
		});

		const parser = new Parser({ fields, eol: '\r\n' });
		const csv = parser.parse(rows);

		res.setHeader('Content-Type', 'text/csv');
		res.setHeader('Content-Disposition', `attachment; filename="job_${jobId}_results.csv"`);
		res.send(csv);
	})
);

module.exports = { jobsRouter };
