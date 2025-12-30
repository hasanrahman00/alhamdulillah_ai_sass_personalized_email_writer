const path = require('path');

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

function numberEnv(name, fallback) {
	const raw = process.env[name];
	if (!raw) return fallback;
	const num = Number(raw);
	return Number.isFinite(num) ? num : fallback;
}

function boolEnv(name, fallback = false) {
	const raw = String(process.env[name] ?? '').trim().toLowerCase();
	if (!raw) return fallback;
	return ['1', 'true', 'yes', 'y', 'on'].includes(raw);
}

const config = {
	port: numberEnv('PORT', 3001),
	corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
	sqlitePath: process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'app.sqlite'),
	uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'),
	maxUploadBytes: numberEnv('MAX_UPLOAD_MB', 10) * 1024 * 1024,
	workerConcurrency: numberEnv('WORKER_CONCURRENCY', 3),
	scrapeConcurrency: numberEnv('SCRAPE_CONCURRENCY', 5),
	scrapeTimeoutMs: numberEnv('SCRAPE_TIMEOUT_MS', 30000),
	aiTimeoutMs: numberEnv('AI_TIMEOUT_MS', 45000),
	maxScrapedChars: numberEnv('MAX_SCRAPED_CHARS', 6000),
	logActivityContext: boolEnv('LOG_ACTIVITY_CONTEXT', false),
	logActivityContextMaxChars: numberEnv('LOG_ACTIVITY_CONTEXT_MAX_CHARS', 2000),
	deepSeek: {
		apiKey: process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_KEY || process.env.DEEPSEEK_TOKEN || '',
		apiUrl: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions',
		model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
	},
	defaultServicesContext: process.env.VIKILEADS_SERVICES_CONTEXT || '',
	ourCompanyName: process.env.OUR_COMPANY_NAME || 'VikiLeads',
	peakLeadServicesContext:
		process.env.PEAKLEAD_SERVICES_CONTEXT ||
		'LinkedIn scraping for verified leads; highly targeted B2B contact lists; personalized cold outreach setup; higher reply rates & booked meetings.',
};

module.exports = { config, requireEnv };
