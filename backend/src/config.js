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

const logActivityContext = boolEnv('LOG_ACTIVITY_CONTEXT', false);

const config = {
	port: numberEnv('PORT', 3001),
	corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
	sqlitePath: process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'app.sqlite'),
	uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'),
	maxUploadBytes: numberEnv('MAX_UPLOAD_MB', 10) * 1024 * 1024,
	workerConcurrency: numberEnv('WORKER_CONCURRENCY', 3),
	scrapeConcurrency: numberEnv('SCRAPE_CONCURRENCY', 5),
	scrapeTimeoutMs: numberEnv('SCRAPE_TIMEOUT_MS', 30000),
	scrapeProxyUrl: process.env.SCRAPE_PROXY_URL || process.env.FLOPPYDATA_PROXY_URL || '',
	scrapeProxyRotationMinutes: numberEnv('SCRAPE_PROXY_ROTATION_MINUTES', 5),
	scrapeProxyMaxRetries: numberEnv('SCRAPE_PROXY_MAX_RETRIES', 2),
	aiTimeoutMs: numberEnv('AI_TIMEOUT_MS', 45000),
	maxScrapedChars: numberEnv('MAX_SCRAPED_CHARS', 6000),
	logActivityContext,
	logActivityContextMaxChars: numberEnv('LOG_ACTIVITY_CONTEXT_MAX_CHARS', 2000),
	logBulkPrompt: boolEnv('LOG_BULK_PROMPT', logActivityContext),
	logBulkPromptMaxChars: numberEnv('LOG_BULK_PROMPT_MAX_CHARS', 4000),
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

if (config.scrapeProxyUrl) {
	try {
		// eslint-disable-next-line no-new
		new URL(config.scrapeProxyUrl);
	} catch {
		throw new Error('Invalid SCRAPE_PROXY_URL / FLOPPYDATA_PROXY_URL (must be a valid URL)');
	}
}

module.exports = { config, requireEnv };
