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

jobsRouter.post(
	'/start',
	asyncHandler(async (req, res) => {
		const schema = z.object({ fileId: z.number().int().positive() });
		const { fileId } = schema.parse(req.body);

		const db = await getDb();
		const file = await db.get('SELECT * FROM files WHERE id = ? AND user_id = ?', fileId, DEFAULT_USER_ID);
		if (!file) throw new HttpError(404, 'File not found');

		const existing = await db.get(
			"SELECT * FROM jobs WHERE file_id = ? AND user_id = ? AND status IN ('queued','running','completed') ORDER BY id DESC LIMIT 1",
			fileId,
			DEFAULT_USER_ID
		);
		if (existing) {
			return res.json({ job: existing, reused: true });
		}

		const columnMap = JSON.parse(file.column_map_json);

		const jobInsert = await db.run(
			"INSERT INTO jobs (user_id, file_id, status, total_rows, processed_rows, error_count, started_at) VALUES (?, ?, 'queued', 0, 0, 0, NULL)",
			DEFAULT_USER_ID,
			fileId
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
						const websiteRaw = columnMap.website ? withHttps(row[columnMap.website]) : '';
						const activityContext = columnMap.activityContext ? row[columnMap.activityContext] : '';
						const normalized = normalizeWebsiteInput(websiteRaw);
						const website = normalized.ok ? normalized.homepageUrl : '';
						const ourServices = columnMap.ourServices ? row[columnMap.ourServices] : '';

						await db.run(
							`INSERT INTO prospects (
								user_id, file_id, job_id, row_index, status,
								first_name, last_name, email, company, website, activity_context, our_services,
								original_row_json
							) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)` ,
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
			'SELECT row_index, first_name, subject, opening_line, email_body, cta FROM prospects WHERE job_id = ? ORDER BY row_index ASC',
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
			const opening = ensureNamePrefix(out.opening_line, out.first_name);
			const parts = [opening, out.email_body, out.cta]
				.map((s) => String(s || '').trim())
				.filter(Boolean);
			return parts.join('\n\n');
		}

		const originalHeaders = JSON.parse(file.header_json);
		const extraCols = ['subject', 'opening_line', 'email_body', 'cta'];
		const fields = Array.from(new Set([...originalHeaders, ...extraCols]));

		const rows = [];
		let idx = 0;
		await new Promise((resolve, reject) => {
			fs.createReadStream(file.stored_path)
				.pipe(csvParser())
				.on('data', (row) => {
					const out = map.get(idx);
					idx++;
					rows.push({
						...row,
						subject: out?.subject || '',
						opening_line: out?.opening_line || '',
						email_body: buildFullEmail(out),
						cta: out?.cta || '',
					});
				})
				.on('error', (err) => reject(err))
				.on('end', () => resolve());
		});

		const parser = new Parser({ fields });
		const csv = parser.parse(rows);

		res.setHeader('Content-Type', 'text/csv');
		res.setHeader('Content-Disposition', `attachment; filename="job_${jobId}_results.csv"`);
		res.send(csv);
	})
);

module.exports = { jobsRouter };
