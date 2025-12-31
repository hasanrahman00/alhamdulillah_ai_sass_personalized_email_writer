function sanitizeSessionId(value) {
	const raw = String(value || '').trim();
	if (!raw) return '';
	// FloppyData: max length 128; avoid spaces/special chars.
	const safe = raw.replace(/[^a-zA-Z0-9_.-]/g, '_');
	return safe.slice(0, 128);
}

function hostnameOf(targetUrl) {
	try {
		const u = new URL(String(targetUrl || ''));
		return String(u.hostname || '').toLowerCase();
	} catch {
		return '';
	}
}

function rotationBucket(rotationMinutes) {
	const mins = Number(rotationMinutes);
	if (!Number.isFinite(mins) || mins <= 0) return String(Date.now());
	const ms = mins * 60 * 1000;
	return String(Math.floor(Date.now() / ms));
}

function buildSessionId(prefix, targetUrl, rotationMinutes = 5, attempt = 0) {
	const host = hostnameOf(targetUrl);
	const bucket = rotationBucket(rotationMinutes);
	const retry = Number(attempt) || 0;
	return sanitizeSessionId([prefix, host, bucket, retry ? `r${retry}` : ''].filter(Boolean).join('_'));
}

function replaceOrAppendSessionInUsername(username, sessionId) {
	const u = String(username || '');
	const sid = sanitizeSessionId(sessionId);
	if (!sid) return u;

	// Replace existing -session-... segment if present.
	if (/-session-[^-:]+/i.test(u)) {
		return u.replace(/-session-[^-:]+/i, `-session-${sid}`);
	}

	// If no session segment exists, leave unchanged (avoids changing proxy semantics).
	return u;
}

function buildProxyUrlForSession(baseProxyUrl, sessionId) {
	const base = String(baseProxyUrl || '').trim();
	if (!base) return '';

	let url;
	try {
		url = new URL(base);
	} catch {
		return '';
	}

	url.username = replaceOrAppendSessionInUsername(url.username, sessionId);
	return url.toString();
}

function toPlaywrightProxy(proxyUrl) {
	if (!proxyUrl) return null;
	let url;
	try {
		url = new URL(proxyUrl);
	} catch {
		return null;
	}

	const server = `${url.protocol}//${url.host}`;
	return {
		server,
		username: url.username || undefined,
		password: url.password || undefined,
	};
}

module.exports = {
	buildSessionId,
	buildProxyUrlForSession,
	toPlaywrightProxy,
};
