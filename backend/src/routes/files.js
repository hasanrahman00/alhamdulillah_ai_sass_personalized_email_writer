const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');

const { asyncHandler } = require('../util/async-handler');
const { HttpError } = require('../util/http-error');
const { getDb } = require('../db');
const { config } = require('../config');
const { deriveColumnMap, validateRequiredColumns } = require('../csv/columns');

const csvParser = require('csv-parser');

const filesRouter = express.Router();

const DEFAULT_USER_ID = 1;

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true });
}

function safeFileNamePart(name) {
	return String(name || '')
		.replace(/[^a-zA-Z0-9._-]+/g, '_')
		.slice(0, 120);
}

function createStorage() {
	return multer.diskStorage({
		destination: (req, _file, cb) => {
			const userDir = path.join(config.uploadDir, String(DEFAULT_USER_ID));
			ensureDir(userDir);
			cb(null, userDir);
		},
		filename: (_req, file, cb) => {
			const ext = path.extname(file.originalname || '').toLowerCase() || '.csv';
			const id = crypto.randomBytes(8).toString('hex');
			cb(null, `upload_${Date.now()}_${id}${ext}`);
		},
	});
}

const upload = multer({
	storage: createStorage(),
	limits: { fileSize: config.maxUploadBytes },
	fileFilter: (_req, file, cb) => {
		const name = String(file.originalname || '').toLowerCase();
		const ok =
			name.endsWith('.csv') ||
			name.endsWith('.xlsx') ||
			name.endsWith('.xls') ||
			(file.mimetype && (file.mimetype.includes('csv') || file.mimetype.includes('spreadsheet') || file.mimetype.includes('excel')));
		if (!ok) return cb(new HttpError(400, 'Only CSV or Excel uploads are supported (.csv, .xlsx, .xls)'));
		return cb(null, true);
	},
});

function isBlank(v) {
	return String(v || '').trim().length === 0;
}

function extOf(name) {
	return String(path.extname(name || '') || '').toLowerCase();
}

async function parseCsvRows(filePath, maxRowsForPreview = 20) {
	return new Promise((resolve, reject) => {
		const previewRows = [];
		let headers = null;
		let allRowsCount = 0;
		let firstRowWithError = null;

		fs.createReadStream(filePath)
			.pipe(csvParser())
			.on('headers', (h) => {
				headers = h;
			})
			.on('data', (row) => {
				allRowsCount++;
				if (previewRows.length < maxRowsForPreview) previewRows.push(row);
				if (!firstRowWithError) {
					// firstRowWithError is set later after we know column map
				}
			})
			.on('error', (err) => reject(err))
			.on('end', () => resolve({ headers: headers || [], previewRows, totalRows: allRowsCount }));
	});
}

function parseExcel(filePath, maxRowsForPreview = 20) {
	const wb = XLSX.readFile(filePath, { cellDates: true });
	const sheetName = wb.SheetNames && wb.SheetNames.length ? wb.SheetNames[0] : null;
	if (!sheetName) return { headers: [], rows: [], previewRows: [], totalRows: 0 };
	const ws = wb.Sheets[sheetName];
	// rows as arrays so we can preserve empty cells
	const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, blankrows: false, defval: '' });
	if (!Array.isArray(matrix) || matrix.length === 0) return { headers: [], rows: [], previewRows: [], totalRows: 0 };
	const headers = (matrix[0] || []).map((h) => String(h || '').trim()).filter(Boolean);
	const dataRows = matrix.slice(1);
	const rows = dataRows.map((arr) => {
		const obj = {};
		for (let i = 0; i < headers.length; i++) {
			obj[headers[i]] = String((arr && arr[i] != null) ? arr[i] : '').trim();
		}
		return obj;
	});
	return {
		headers,
		rows,
		previewRows: rows.slice(0, maxRowsForPreview),
		totalRows: rows.length,
	};
}

function validateRows({ rows, columnMap }) {
	const errors = [];
	const fnCol = columnMap.firstName;
	const lnCol = columnMap.lastName;
	const companyCol = columnMap.company;
	const websiteCol = columnMap.website;
	const activityCol = columnMap.activityContext;

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i] || {};
		const firstName = fnCol ? row[fnCol] : '';
		const lastName = lnCol ? row[lnCol] : '';
		const company = companyCol ? row[companyCol] : '';
		const website = websiteCol ? row[websiteCol] : '';
		const activity = activityCol ? row[activityCol] : '';

		const missingRequired = [];
		if (isBlank(firstName)) missingRequired.push('First Name');
		if (isBlank(lastName)) missingRequired.push('Last Name');
		if (isBlank(company)) missingRequired.push('Company');

		let hasContext = true;
		if (websiteCol && activityCol) {
			hasContext = !isBlank(website) || !isBlank(activity);
		} else if (websiteCol) {
			hasContext = !isBlank(website);
		} else if (activityCol) {
			hasContext = !isBlank(activity);
		}

		if (missingRequired.length || !hasContext) {
			errors.push({
				rowIndex: i + 2, // +1 header +1 1-based
				missingRequired,
				missingContext: !hasContext,
			});
			if (errors.length >= 5) break;
		}
	}

	return errors;
}

function buildSampleRows() {
	return [
		{
			'First Name': 'Sarah',
			'Last Name': 'Khan',
			Company: 'Acme Corp',
			'Website / Activity URL': 'https://example.com/blog/product-launch',
			'Activity Context': '',
		},
		{
			'First Name': 'Omar',
			'Last Name': 'Ali',
			Company: 'Beta Systems',
			'Website / Activity URL': '',
			'Activity Context': 'Posted about hiring SDRs and expanding outbound. New RevOps role open.',
		},
	];
}

filesRouter.post(
	'/upload',
	upload.single('file'),
	asyncHandler(async (req, res) => {
		if (!req.file) throw new HttpError(400, 'Missing file');

		const originalName = String(req.file.originalname || '');
		const ext = extOf(originalName);

		let headers = [];
		let previewRows = [];
		let totalRows = 0;
		let storedPath = req.file.path;

		if (ext === '.csv') {
			const parsed = await parseCsvRows(req.file.path, 20);
			headers = parsed.headers;
			previewRows = parsed.previewRows;
			totalRows = parsed.totalRows;
		} else if (ext === '.xlsx' || ext === '.xls') {
			const parsed = parseExcel(req.file.path, 20);
			headers = parsed.headers;
			previewRows = parsed.previewRows;
			totalRows = parsed.totalRows;

			// Convert Excel to CSV on disk so the rest of the pipeline can stay CSV-based.
			const wb = XLSX.readFile(req.file.path, { cellDates: true });
			const sheetName = wb.SheetNames && wb.SheetNames.length ? wb.SheetNames[0] : null;
			if (!sheetName) {
				fs.unlinkSync(req.file.path);
				throw new HttpError(400, 'Excel file appears to have no sheets');
			}
			const ws = wb.Sheets[sheetName];
			const csv = XLSX.utils.sheet_to_csv(ws);
			const csvPath = req.file.path.replace(/\.(xlsx|xls)$/i, '.csv');
			fs.writeFileSync(csvPath, csv, 'utf8');
			fs.unlinkSync(req.file.path);
			storedPath = csvPath;
		} else {
			fs.unlinkSync(req.file.path);
			throw new HttpError(400, 'Unsupported file type');
		}

		if (!headers.length) {
			if (fs.existsSync(storedPath)) fs.unlinkSync(storedPath);
			throw new HttpError(400, 'File appears to have no header row');
		}

		const columnMap = deriveColumnMap(headers);
		const missing = validateRequiredColumns(columnMap);
		if (missing.length) {
			if (fs.existsSync(storedPath)) fs.unlinkSync(storedPath);

			const pretty = {
				firstName: 'First Name',
				lastName: 'Last Name',
				company: 'Company',
				websiteOrActivityContext: 'Website / Activity URL or Activity Context',
			};
			const missingPretty = missing.map((k) => pretty[k] || k);
			throw new HttpError(
				400,
				`Missing required columns: ${missingPretty.join(', ')}. Required: First Name, Last Name, Company, and at least one of Website / Activity URL or Activity Context.`,
				{ expose: true }
			);
		}

		// Per-row validation for required values.
		let rowsForValidation = previewRows;
		if (totalRows > previewRows.length) {
			// For CSV storedPath, stream and validate all rows (file sizes are expected to be small in this MVP).
			if (ext === '.csv' || storedPath.toLowerCase().endsWith('.csv')) {
				rowsForValidation = [];
				await new Promise((resolve, reject) => {
					fs.createReadStream(storedPath)
						.pipe(csvParser())
						.on('data', (row) => rowsForValidation.push(row))
						.on('error', (err) => reject(err))
						.on('end', () => resolve());
				});
			}
		}

		const rowErrors = validateRows({ rows: rowsForValidation, columnMap });
		if (rowErrors.length) {
			if (fs.existsSync(storedPath)) fs.unlinkSync(storedPath);
			const first = rowErrors[0];
			const details = [];
			if (first.missingRequired && first.missingRequired.length) {
				details.push(`missing required values: ${first.missingRequired.join(', ')}`);
			}
			if (first.missingContext) {
				details.push('must include either Website / Activity URL OR Activity Context');
			}
			throw new HttpError(
				400,
				`Row validation failed at row ${first.rowIndex}: ${details.join('; ')}.`,
				{ expose: true }
			);
		}

		const db = await getDb();
		const result = await db.run(
			'INSERT INTO files (user_id, original_filename, stored_path, header_json, column_map_json) VALUES (?, ?, ?, ?, ?)',
			DEFAULT_USER_ID,
			safeFileNamePart(req.file.originalname),
			storedPath,
			JSON.stringify(headers),
			JSON.stringify(columnMap)
		);

		res.json({
			file: {
				id: result.lastID,
				originalFilename: req.file.originalname,
				headers,
				columnMap,
			},
			preview: previewRows,
		});
	})
);

filesRouter.get(
	'/sample',
	asyncHandler(async (req, res) => {
		const format = String(req.query.format || 'csv').toLowerCase();
		const rows = buildSampleRows();
		const headers = Object.keys(rows[0] || {
			'First Name': '',
			'Last Name': '',
			Company: '',
			'Website / Activity URL': '',
			'Activity Context': '',
		});

		if (format === 'xlsx') {
			const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
			const wb = XLSX.utils.book_new();
			XLSX.utils.book_append_sheet(wb, ws, 'Prospects');
			const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
			res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
			res.setHeader('Content-Disposition', 'attachment; filename="sample_upload.xlsx"');
			return res.send(buf);
		}

		// Default: CSV
		const lines = [headers.join(',')]
			.concat(
				rows.map((r) =>
					headers
						.map((h) => {
							const v = String((r && r[h]) || '');
							const escaped = v.replace(/"/g, '""');
							return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
						})
						.join(',')
				)
			)
			.join('\n');

		res.setHeader('Content-Type', 'text/csv');
		res.setHeader('Content-Disposition', 'attachment; filename="sample_upload.csv"');
		return res.send(lines);
	})
);

filesRouter.get(
	'/',
	asyncHandler(async (req, res) => {
		const db = await getDb();
		const files = await db.all(
			'SELECT id, original_filename, created_at FROM files WHERE user_id = ? ORDER BY id DESC LIMIT 50',
			DEFAULT_USER_ID
		);
		res.json({ files });
	})
);

module.exports = { filesRouter };
