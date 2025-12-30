function normalizeHeader(header) {
	return String(header || '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, ' ');
}

function findColumn(headers, candidates) {
	const normalized = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
	for (const candidate of candidates) {
		const candidateNorm = normalizeHeader(candidate);
		const exact = normalized.find((h) => h.norm === candidateNorm);
		if (exact) return exact.raw;
	}

	// loose contains match
	for (const candidate of candidates) {
		const candidateNorm = normalizeHeader(candidate);
		const hit = normalized.find((h) => h.norm.includes(candidateNorm) || candidateNorm.includes(h.norm));
		if (hit) return hit.raw;
	}

	return null;
}

function deriveColumnMap(headers) {
	const firstName = findColumn(headers, ['first name', 'firstname', 'first']);
	const lastName = findColumn(headers, ['last name', 'lastname', 'last']);
	const company = findColumn(headers, ['company', 'company name', 'organization', 'business']);
	const website = findColumn(headers, [
		'website / activity url',
		'website or activity url',
		'website',
		'website url',
		'url',
		'site',
		'domain',
	]);
	const activityContext = findColumn(headers, ['activity context', 'context', 'activity', 'notes', 'personalization context']);
	const email = findColumn(headers, ['email', 'email address']);
	const ourServices = findColumn(headers, ['our services', 'services', 'service focus', 'service_focus']);

	return {
		firstName,
		lastName,
		company,
		website,
		activityContext,
		email,
		ourServices,
	};
}

function validateRequiredColumns(columnMap) {
	const missing = [];
	for (const key of ['firstName', 'lastName', 'company']) {
		if (!columnMap[key]) missing.push(key);
	}

	// At least one of these columns must exist.
	if (!columnMap.website && !columnMap.activityContext) {
		missing.push('websiteOrActivityContext');
	}
	return missing;
}

module.exports = { deriveColumnMap, validateRequiredColumns };
