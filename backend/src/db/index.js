const fs = require('fs');
const path = require('path');

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const { config } = require('../config');

let dbPromise;

async function getDb() {
	if (!dbPromise) {
		throw new Error('DB not initialized. Call initDb() first.');
	}
	return dbPromise;
}

async function initDb() {
	if (dbPromise) return dbPromise;

	const dbPath = path.isAbsolute(config.sqlitePath)
		? config.sqlitePath
		: path.join(__dirname, '..', '..', config.sqlitePath);

	fs.mkdirSync(path.dirname(dbPath), { recursive: true });

	dbPromise = open({
		filename: dbPath,
		driver: sqlite3.Database,
	});

	const db = await dbPromise;
	await db.exec('PRAGMA journal_mode = WAL;');
	await db.exec('PRAGMA foreign_keys = ON;');

	await db.exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS files (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			original_filename TEXT NOT NULL,
			stored_path TEXT NOT NULL,
			header_json TEXT NOT NULL,
			column_map_json TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS jobs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			file_id INTEGER NOT NULL,
			settings_json TEXT,
			status TEXT NOT NULL,
			total_rows INTEGER NOT NULL DEFAULT 0,
			processed_rows INTEGER NOT NULL DEFAULT 0,
			error_count INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			started_at TEXT,
			finished_at TEXT,
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS prospects (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			file_id INTEGER NOT NULL,
			job_id INTEGER NOT NULL,
			row_index INTEGER NOT NULL,
			status TEXT NOT NULL,
			error TEXT,
			first_name TEXT,
			last_name TEXT,
			email TEXT,
			company TEXT,
			website TEXT,
			activity_context TEXT,
			our_services TEXT,
			original_row_json TEXT NOT NULL,
			scraped_content TEXT,
			subject TEXT,
			opening_line TEXT,
			email_body TEXT,
			cta TEXT,
			followups_json TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now')),
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE,
			FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
			UNIQUE(job_id, row_index)
		);

		CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
		CREATE INDEX IF NOT EXISTS idx_prospects_job ON prospects(job_id);
		CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
	`);

	// Lightweight migrations (SQLite): add new columns if missing.
	try {
		const prospectCols = await db.all(`PRAGMA table_info('prospects')`);
		const prospectNames = new Set(prospectCols.map((c) => String(c.name)));
		if (!prospectNames.has('activity_context')) {
			await db.exec(`ALTER TABLE prospects ADD COLUMN activity_context TEXT`);
		}
		if (!prospectNames.has('followups_json')) {
			await db.exec(`ALTER TABLE prospects ADD COLUMN followups_json TEXT`);
		}

		const jobCols = await db.all(`PRAGMA table_info('jobs')`);
		const jobNames = new Set(jobCols.map((c) => String(c.name)));
		if (!jobNames.has('settings_json')) {
			await db.exec(`ALTER TABLE jobs ADD COLUMN settings_json TEXT`);
		}
	} catch {
		// Best-effort: don't block startup if migration check fails.
	}

	// Single-tenant / no-auth MVP: ensure an implicit default user exists.
	await db.run(
		"INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (1, 'internal@local', 'disabled')"
	);

	return db;
}

module.exports = { initDb, getDb };
