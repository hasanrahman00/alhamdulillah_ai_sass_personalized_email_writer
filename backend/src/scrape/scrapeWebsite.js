const { chromium } = require('playwright');
const { config } = require('../config');
const { normalizeWebsiteInput } = require('../util/website');
const { buildSessionId, buildProxyUrlForSession, toPlaywrightProxy } = require('./scrapeProxy');

let browserPromise;

async function getBrowser() {
	if (!browserPromise) {
		browserPromise = chromium.launch({ headless: true });
	}
	return browserPromise;
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

async function extractFromPage(page) {
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

	return { metaDescription: cleanText(metaDescription || ''), headings, bodyText: cleanText(bodyText) };
}

function sameOriginLinks(baseUrl, links) {
	let base;
	try {
		base = new URL(baseUrl);
	} catch {
		return [];
	}

	const result = [];
	for (const href of links) {
		try {
			const url = new URL(href, base);
			if (url.origin !== base.origin) continue;
			url.hash = '';
			result.push(url.toString());
		} catch {
			// ignore
		}
	}
	return Array.from(new Set(result));
}

async function scrapeWebsite(websiteUrl) {
	const normalized = normalizeWebsiteInput(websiteUrl);
	if (!normalized.ok || !normalized.homepageUrl) return '';
	const homepageUrl = normalized.homepageUrl;

	const maxRetries = Math.max(0, Number(config.scrapeProxyMaxRetries) || 0);
	const shouldUseProxy = Boolean(config.scrapeProxyUrl);
	const rotationMinutes = Number(config.scrapeProxyRotationMinutes) || 5;

	async function runOnce(attempt) {
		const sessionId = buildSessionId('site', homepageUrl, rotationMinutes, attempt);
		const proxyUrl = shouldUseProxy ? buildProxyUrlForSession(config.scrapeProxyUrl, sessionId) : '';
		const proxy = proxyUrl ? toPlaywrightProxy(proxyUrl) : null;

		const browser = await getBrowser();
		const context = await browser.newContext({
			userAgent:
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
			proxy: proxy || undefined,
			ignoreHTTPSErrors: true,
		});

		await context.route('**/*', (route) => {
			const resourceType = route.request().resourceType();
			if (['image', 'font', 'media'].includes(resourceType)) return route.abort();
			return route.continue();
		});

		const page = await context.newPage();
		page.setDefaultTimeout(config.scrapeTimeoutMs);

		try {
			await page.goto(homepageUrl, { waitUntil: 'domcontentloaded' });
			await page.waitForLoadState('networkidle').catch(() => null);

			const main = await extractFromPage(page);

			const candidateLinks = await page
				.evaluate(() => {
					const links = Array.from(document.querySelectorAll('a[href]'));
					return links.map((a) => a.getAttribute('href') || '').filter(Boolean);
				})
				.catch(() => []);

			const internal = sameOriginLinks(homepageUrl, candidateLinks);
			const aboutOrServices = internal
				.filter((u) => /about|services|service|solutions|what-we-do|product/i.test(u))
				.slice(0, 2);

			const extraPages = [];
			for (const url of aboutOrServices) {
				await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => null);
				await page.waitForLoadState('networkidle').catch(() => null);
				extraPages.push({ url, ...(await extractFromPage(page)) });
			}

			const parts = [];
			if (main.metaDescription) parts.push(`Meta: ${main.metaDescription}`);
			if (main.headings.length) parts.push(`Headings: ${main.headings.join(' | ')}`);
			if (main.bodyText) parts.push(`Homepage Text:\n${main.bodyText}`);

			for (const p of extraPages) {
				parts.push(`\nPage: ${p.url}`);
				if (p.metaDescription) parts.push(`Meta: ${p.metaDescription}`);
				if (p.headings?.length) parts.push(`Headings: ${p.headings.join(' | ')}`);
				if (p.bodyText) parts.push(p.bodyText);
			}

			const combined = cap(parts.join('\n\n'), config.maxScrapedChars);
			// If extraction is too thin, treat it as no-insights.
			if (!combined || combined.replace(/\s+/g, ' ').trim().length < 120) return '';
			return combined;
		} catch {
			return '';
		} finally {
			await page.close().catch(() => null);
			await context.close().catch(() => null);
		}
	}

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		const out = await runOnce(attempt);
		if (out) return out;
		if (!shouldUseProxy) break;
	}

	// DNS errors, timeouts, blocked sites, expired domains, etc. -> no-insights.
	return '';
}

module.exports = { scrapeWebsite };
