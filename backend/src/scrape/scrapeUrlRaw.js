const { chromium } = require('playwright');
const { fetch, ProxyAgent } = require('undici');
const PQueue = require('p-queue').default;

const { config } = require('../config');
const { HttpError } = require('../util/http-error');
const { buildSessionId, buildProxyUrlForSession, toPlaywrightProxy } = require('./scrapeProxy');

let browserPromise;
let scrapeQueue;

async function getBrowser() {
	if (!browserPromise) {
		browserPromise = chromium.launch({ headless: true });
	}
	return browserPromise;
}

function getScrapeQueue() {
	if (!scrapeQueue) {
		scrapeQueue = new PQueue({
			concurrency: Math.max(1, Number(config.scrapeConcurrency) || 1),
		});
	}
	return scrapeQueue;
}

function extractTextFromHtml(html) {
	const raw = String(html || '');
	if (!raw) return '';

	// Remove scripts/styles/noscript.
	let cleaned = raw
		.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
		.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
		.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ');

	// Add breaks for common block separators.
	cleaned = cleaned
		.replace(/<\s*br\s*\/?\s*>/gi, '\n')
		.replace(/<\s*\/p\s*>/gi, '\n\n')
		.replace(/<\s*\/div\s*>/gi, '\n\n')
		.replace(/<\s*\/li\s*>/gi, '\n');

	// Strip tags.
	cleaned = cleaned.replace(/<[^>]+>/g, ' ');

	// Minimal entity decoding.
	cleaned = cleaned
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>');

	return cleanText(cleaned);
}

async function scrapeUrlRawHttpFallback(url, proxyUrl) {
	const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
	const res = await fetch(url, {
		redirect: 'follow',
		dispatcher,
		headers: {
			'user-agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
			'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			'accept-language': 'en-US,en;q=0.9',
		},
	});

	const status = Number(res.status || 0);
	if (!res.ok) {
		throw new HttpError(422, 'Not able to open the URL or extract content.', {
			expose: true,
			details: { url, cause: { name: 'HttpFetchError', message: `HTTP ${status}` } },
		});
	}

	const html = await res.text();
	const text = extractTextFromHtml(html);
	const combined = cap(`Page Text:\n${text}`, config.maxScrapedChars);
	const compact = combined.replace(/\s+/g, ' ').trim();
	if (!compact || compact.length < 160) {
		throw new HttpError(422, 'Not able to read the URL content for personalization. Please paste the Activity Text / Context instead.', {
			expose: true,
			details: { url, cause: { name: 'HttpFetchThinContent', message: 'Fetched HTML but extracted too little readable text' } },
		});
	}

	return combined;
}

function cleanText(text) {
	return String(text || '')
		.replace(/\u00a0/g, ' ')
		.replace(/[\t ]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function cap(text, maxChars) {
	const t = cleanText(text);
	if (t.length <= maxChars) return t;
	return t.slice(0, maxChars) + '…';
}

function capForLog(text) {
	return cap(text, Math.max(200, Number(config.logActivityContextMaxChars) || 2000));
}

async function extractFromPage(page) {
	const title = await page.title().catch(() => '');
	const metaDescription = await page
		.locator('meta[name="description"]')
		.first()
		.getAttribute('content')
		.catch(() => null);

	const headings = await page
		.evaluate(() => {
			const hs = Array.from(document.querySelectorAll('h1, h2, h3'));
			return hs
				.map((h) => (h && h.innerText ? h.innerText.trim() : ''))
				.filter(Boolean)
				.slice(0, 25);
		})
		.catch(() => []);

	const bodyText = await page
		.evaluate(() => (document.body ? document.body.innerText : ''))
		.catch(() => '');

	return {
		title: cleanText(title || ''),
		metaDescription: cleanText(metaDescription || ''),
		headings,
		bodyText: cleanText(bodyText || ''),
	};
}

function ensureHttpUrl(rawUrl) {
	const raw = String(rawUrl || '').trim();
	if (!raw) throw new HttpError(400, 'Company / Activity URL is required', { expose: true });

	// Do not normalize or mutate the user input; just validate basic safety.
	if (/^(mailto:|tel:|javascript:|data:)/i.test(raw)) {
		throw new HttpError(400, 'Unsupported URL scheme', { expose: true });
	}

	if (!/^https?:\/\//i.test(raw)) {
		throw new HttpError(400, 'Company / Activity URL must start with http:// or https://', { expose: true });
	}

	let url;
	try {
		url = new URL(raw);
	} catch {
		throw new HttpError(400, 'Invalid URL', { expose: true });
	}

	if (!(url.protocol === 'http:' || url.protocol === 'https:')) {
		throw new HttpError(400, 'Unsupported URL protocol', { expose: true });
	}

	return raw;
}

async function scrapeUrlRaw(userProvidedUrl) {
	const url = ensureHttpUrl(userProvidedUrl);
	const shouldUseProxy = Boolean(config.scrapeProxyUrl);
	const rotationMinutes = Number(config.scrapeProxyRotationMinutes) || 5;
	const maxRetries = Math.max(0, Number(config.scrapeProxyMaxRetries) || 0);

	// IMPORTANT: Scraping is resource-heavy (CPU/RAM/network). Do not run unbounded parallel navigations.
	// Use a queue so the API can handle high user concurrency without crashing the host.
	return getScrapeQueue().add(async () => {
		async function runOnce(attempt) {
			const sessionId = buildSessionId('url', url, rotationMinutes, attempt);
			const proxyUrl = shouldUseProxy ? buildProxyUrlForSession(config.scrapeProxyUrl, sessionId) : '';
			const proxy = proxyUrl ? toPlaywrightProxy(proxyUrl) : null;

			const browser = await getBrowser();
			const context = await browser.newContext({
				userAgent:
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
				ignoreHTTPSErrors: true,
				proxy: proxy || undefined,
			});

		// Reduce bandwidth/cost.
		await context.route('**/*', (route) => {
			const resourceType = route.request().resourceType();
			if (['image', 'font', 'media'].includes(resourceType)) return route.abort();
			return route.continue();
		});

			const page = await context.newPage();
			page.setDefaultTimeout(config.scrapeTimeoutMs);

			try {
				await page.goto(url, { waitUntil: 'domcontentloaded' });
				await page.waitForLoadState('networkidle').catch(() => null);

				const extracted = await extractFromPage(page);

				const parts = [];
				if (extracted.title) parts.push(`Title: ${extracted.title}`);
				if (extracted.metaDescription) parts.push(`Meta: ${extracted.metaDescription}`);
				if (extracted.headings.length) parts.push(`Headings: ${extracted.headings.join(' | ')}`);
				if (extracted.bodyText) parts.push(`Page Text:\n${extracted.bodyText}`);

				const combined = cap(parts.join('\n\n'), config.maxScrapedChars);
				const compact = combined.replace(/\s+/g, ' ').trim();

				// If extraction is too thin (blocked/login/empty), treat as failure.
				if (!compact || compact.length < 160) {
					throw new HttpError(422, 'Not able to read the URL content for personalization. Please paste the Activity Text / Context instead.', {
						expose: true,
					});
				}

				if (config.logActivityContext) {
					// eslint-disable-next-line no-console
					console.log(
						[
							'\n================ SCRAPED ACTIVITY CONTEXT (URL) ================',
							`URL: ${url}`,
							capForLog(combined),
							'================ END SCRAPED ACTIVITY CONTEXT =================\n',
						].join('\n')
					);
				}
				return { ok: true, value: combined };
			} catch (err) {
				return { ok: false, err };
			} finally {
				await page.close().catch(() => null);
				await context.close().catch(() => null);
			}
		}

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			const res = await runOnce(attempt);
			if (res.ok) return res.value;

			const err = res.err;
			if (err instanceof HttpError) {
				// Only retry proxy-using scrapes for likely-block/timeout/thin-content cases.
				if (!shouldUseProxy) throw err;
				if (attempt >= maxRetries) throw err;
				if (Number(err.statusCode || err.status) === 400) throw err;
				continue;
			}

			// Non-HttpError: could be proxy/network/playwright errors.
			if (!shouldUseProxy || attempt >= maxRetries) {
				const cause = err && typeof err === 'object'
					? {
						name: String(err.name || 'Error'),
						message: String(err.message || ''),
					}
					: { name: 'Error', message: String(err || '') };

				// eslint-disable-next-line no-console
				console.error('scrapeUrlRaw failed', { url, cause });

				// Fallback: try plain HTTP fetch + HTML text extraction (also through proxy when configured).
				const sessionId = buildSessionId('url_http', url, rotationMinutes, 0);
				const proxyUrl = shouldUseProxy ? buildProxyUrlForSession(config.scrapeProxyUrl, sessionId) : '';
				try {
					const fallback = await scrapeUrlRawHttpFallback(url, proxyUrl);
					// eslint-disable-next-line no-console
					console.log('scrapeUrlRaw fallback succeeded', { url });
					return fallback;
				} catch (fallbackErr) {
					if (fallbackErr instanceof HttpError) throw fallbackErr;
					throw new HttpError(422, 'Not able to open the URL or extract content.', {
						expose: true,
						details: { url, cause },
					});
				}
			}
		}

		throw new HttpError(422, 'Not able to open the URL or extract content.', { expose: true });
	});
}

module.exports = { scrapeUrlRaw };
