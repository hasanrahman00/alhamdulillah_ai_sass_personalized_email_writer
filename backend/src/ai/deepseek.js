const { fetch } = require('undici');
const { config } = require('../config');
const { HttpError } = require('../util/http-error');

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

function extractJsonObject(text) {
	const raw = String(text || '').trim();
	if (!raw) throw new Error('Empty AI response');

	// Try direct parse first
	try {
		return JSON.parse(raw);
	} catch {
		// fall through
	}

	const first = raw.indexOf('{');
	const last = raw.lastIndexOf('}');
	if (first === -1 || last === -1 || last <= first) {
		throw new Error('Could not locate JSON object in AI response');
	}

	const candidate = raw.slice(first, last + 1);
	return JSON.parse(candidate);
}

function assertDeepSeekConfigured() {
	if (config.deepSeek.apiKey) return;
	throw new HttpError(500, 'DeepSeek API key is not configured', {
		expose: true,
		details: {
			requiredEnvVars: ['DEEPSEEK_API_KEY', 'DEEPSEEK_KEY', 'DEEPSEEK_TOKEN'],
			envFileHint: 'Create backend/.env (you can copy backend/.env.example) and restart the backend',
		},
	});
}

async function callDeepSeek({ prompt, requestId }) {
	assertDeepSeekConfigured();

	const payload = {
		model: config.deepSeek.model,
		messages: [
			{ role: 'system', content: 'You are an expert B2B cold email copywriter.' },
			{ role: 'user', content: prompt },
		],
		temperature: 0.7,
	};

	const maxAttempts = 4;
	let lastErr;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), config.aiTimeoutMs);

		try {
			const res = await fetch(config.deepSeek.apiUrl, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${config.deepSeek.apiKey}`,
					'Content-Type': 'application/json',
					...(requestId ? { 'X-Request-Id': requestId } : null),
				},
				body: JSON.stringify(payload),
				signal: controller.signal,
			});

			if (res.status === 429 || res.status >= 500) {
				const bodyText = await res.text().catch(() => '');
				lastErr = new Error(`DeepSeek error ${res.status}: ${bodyText}`);
				const backoff = Math.min(8000, 500 * 2 ** (attempt - 1));
				await sleep(backoff);
				continue;
			}

			if (!res.ok) {
				const bodyText = await res.text().catch(() => '');
				throw new Error(`DeepSeek error ${res.status}: ${bodyText}`);
			}

			const data = await res.json();
			const content = data?.choices?.[0]?.message?.content ?? '';
			const parsed = extractJsonObject(content);

			// best-effort logging
			const usage = data?.usage;
			if (usage) {
				// eslint-disable-next-line no-console
				console.log('DeepSeek usage', { requestId, usage });
			}

			return parsed;
		} catch (err) {
			lastErr = err;
			const isAbort = err && (err.name === 'AbortError' || String(err.message).includes('aborted'));
			if (attempt < maxAttempts && (isAbort || String(err.message).includes('429'))) {
				const backoff = Math.min(8000, 500 * 2 ** (attempt - 1));
				await sleep(backoff);
				continue;
			}
			throw err;
		} finally {
			clearTimeout(timeout);
		}
	}

	throw lastErr || new Error('DeepSeek failed');
}

async function callDeepSeekText({ prompt, requestId }) {
	assertDeepSeekConfigured();

	const payload = {
		model: config.deepSeek.model,
		messages: [
			{ role: 'system', content: 'You are an expert B2B cold email copywriter.' },
			{ role: 'user', content: prompt },
		],
		temperature: 0.7,
	};

	const maxAttempts = 4;
	let lastErr;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), config.aiTimeoutMs);

		try {
			const res = await fetch(config.deepSeek.apiUrl, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${config.deepSeek.apiKey}`,
					'Content-Type': 'application/json',
					...(requestId ? { 'X-Request-Id': requestId } : null),
				},
				body: JSON.stringify(payload),
				signal: controller.signal,
			});

			if (res.status === 429 || res.status >= 500) {
				const bodyText = await res.text().catch(() => '');
				lastErr = new Error(`DeepSeek error ${res.status}: ${bodyText}`);
				const backoff = Math.min(8000, 500 * 2 ** (attempt - 1));
				await sleep(backoff);
				continue;
			}

			if (!res.ok) {
				const bodyText = await res.text().catch(() => '');
				throw new Error(`DeepSeek error ${res.status}: ${bodyText}`);
			}

			const data = await res.json();
			const content = data?.choices?.[0]?.message?.content ?? '';

			const usage = data?.usage;
			if (usage) {
				// eslint-disable-next-line no-console
				console.log('DeepSeek usage', { requestId, usage });
			}

			return String(content || '');
		} catch (err) {
			lastErr = err;
			const isAbort = err && (err.name === 'AbortError' || String(err.message).includes('aborted'));
			if (attempt < maxAttempts && (isAbort || String(err.message).includes('429'))) {
				const backoff = Math.min(8000, 500 * 2 ** (attempt - 1));
				await sleep(backoff);
				continue;
			}
			throw err;
		} finally {
			clearTimeout(timeout);
		}
	}

	throw lastErr || new Error('DeepSeek failed');
}

module.exports = { callDeepSeek, callDeepSeekText };
