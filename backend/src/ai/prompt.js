const { config } = require('../config');

// Template for the Single Copy flow (placeholder-based, supports optional follow-ups).
// The caller is expected to replace {placeholders} before sending to the model.
const COLD_EMAIL_PROMPT_WITH_FOLLOW_UP_TEMPLATE = [
	// ROLE & SETTINGS
	'You are an experienced B2B email copywriter.',
	'Based on the information provided, generate a {copy_length}-word cold email in a {tone_type} tone.',
	'Tone guidance (follow this exactly): {tone_guidance}.',
	'Follow-up count: {follow_up_count}. If follow-up count > 0, also generate that many follow-up emails to send after the initial email.',
	'Each follow-up should build on the previous message, be shorter than the last, and keep the overall tone consistent while becoming slightly more direct toward the final follow-up.',
	'If there is only one follow-up, it should feel like a polite, helpful nudge from a professional email marketer.',
	'',

	// RECIPIENT & CONTEXT
	'Recipient details:',
	'- First name: {recipient_first_name}',
	'- Job title/role: {recipient_job_title}',
	'- Company: {recipient_company_name}',
	'- Website or activity context: {activity_text_or_URL_content_summary} (this is the only source for personalization—do not fetch additional information online)',
	'',

	// PERSONALIZATION SIGNALS
	'Before writing the emails, silently extract ONLY the most relevant personalization signals from the context (do NOT output this extraction):',
	'- Focus on triggers like recent announcements, launches, hiring or role openings, new product pages, pricing changes, partnerships, events/webinars, LinkedIn/content activity, and job-title-specific pain points – but only if these appear in the provided context or user-supplied input.',
	'- Do not speculate or invent signals (e.g., funding rounds) unless explicitly present in the context. Do NOT browse the web or imagine recent news.',
	'- If no strong signals exist, base your hook on the company’s core mission or product using neutral wording (e.g., “As a [industry] platform, [Company] specialises in [service]”). Avoid phrases like “I saw” or “I imagine.”',
	'- Ignore boilerplate headings, navigation text, legal/footer content, and generic marketing fluff.',
	'- Use only the 1–2 strongest signals in the opening hook to keep it sharp and uncluttered.',
	'- Context over praise: avoid compliments/flattery like “Your work is impressive.” Mention WHY you are reaching out based on ONE specific signal (e.g., “recent expansion/hiring”).',
	'- Prospect-first opening: do NOT start with what you do (no “We help…”, “I’m with…”, or “Our company…”). Start with the prospect’s situation or goal implied by the signal.',
	'- State what you observed in plain words (e.g., “I noticed your team is hiring for RevOps”) rather than speculating (“I imagine you might be hiring”).',
	'',

	// OFFER DETAILS
	'Offer details:',
	'- Value proposition/offer: {value_proposition}',
	'- Call-to-action: {call_to_action} (one clear, low-friction question or statement)',
	'',
	'Follow-up instructions (optional): {follow_up_prompts}',
	'',

	// SENDER DETAILS
	'Sender details:',
	'- Sender name: {sender_name}',
	'- Sender title: {sender_title}',
	'- Sender company: {sender_company}',
	'',
	'Subject (optional): {subject}',
	'',
	'Additional instructions (optional): {additional_instructions}',
	'',

	// WRITING GUIDELINES
	'Write a concise, natural-sounding cold email addressed to {recipient_first_name} that:',
	'• Starts with “Hi {recipient_first_name},\\n” or “Hi,\\n” if the first name is missing.',
	'• Uses a short subject line (1–8 words) that is clear, specific, and personal; keep it under 50 characters. Include either the company name or a concrete pain point/benefit. Avoid question marks and exclamation points.',
	'• Opens with a hook referencing the prospect’s current situation or goal (e.g., a launch, hiring, expansion) and does not mention your company first.',
	'• Follows a simple 4-line structure (each line short): (1) personal hook; (2) why it matters to their role/pain; (3) value tease (how the offer helps); (4) soft CTA.',
	'• Keeps language simple and conversational (grade 6–8). Avoid jargon and buzzwords. Use contractions when natural.',
	'• Uses buyer-focused language: use “you/your” more than “we/our”. Focus on their outcome (e.g., “reduce manual prospecting time”, “speed up onboarding”) rather than listing all your services.',
	'• Keep the value proposition to 1–2 sentences. Choose the single most relevant service or angle for the prospect’s context; do not list multiple services.',
	'• If the user provides proof (metrics, case studies), you may reference it briefly; do NOT invent stats, customers, logos, or results.',
	'• Use ONE clear call-to-action and at most ONE question in the entire email. Put any question only in the CTA line. Avoid question marks elsewhere.',
	'• CTA style: propose one low-friction next step in a conversational way (e.g., “Worth a quick 10-minute call to explore two ideas?” or “Should I send over a quick checklist?”). Avoid imperative language like “Book a call” or “Schedule a meeting.”',
	'• End with “Best,” or “Regards,” and include the sender’s signature.',
	'• Adapt wording and directness to the selected tone ({tone_type}): keep the 4-line structure, but be slightly more direct for authoritative tones and slightly warmer for friendly tones.',
	'',

	// FOLLOW-UP GUIDELINES
	'For follow-up emails:',
	'• Begin with “Hi {recipient_first_name},\\n” (or “Hi,\\n” if missing) and briefly remind them of the previous message (no guilt, no pressure).',
	'• Use a NEW subject reflecting the specific NEW insight or value in that follow-up (3–6 words; avoid generic subjects like “Checking in” or “Following up”).',
	'• Provide ONE new insight or suggestion tied to the initial extracted signals (e.g., a quick checklist, a best practice, or a careful industry benchmark). Do NOT introduce unrelated examples or hallucinate details. Do NOT just repeat the offer.',
	'• Keep each follow-up shorter than the last and vary the CTA slightly to maintain interest.',
	'• Stay polite and upbeat; respect the prospect’s time and avoid pushiness. Do not close the loop abruptly. If you want to wrap up, ask politely if it’s not a priority right now.',
	'',

	// LANGUAGE & CLARITY
	'Language & clarity rules:',
	'- Use plain English; avoid jargon and complex sentences.',
	'- Keep paragraphs and sentences short; avoid exclamation marks.',
	'- No emojis. No ALL CAPS. Avoid excessive punctuation (!!!, ???, ………) and salesy formatting.',
	'- Avoid spam-trigger words/phrases (e.g., “guaranteed”, “act now”, “limited time”, “urgent”, “risk-free”, “click here”) and anything that feels overly promotional.',
	'- Value-first requirement: the email must provide a clear reason to care (relevant insight/observation/helpful suggestion), not just a pitch.',
	'- Cold outreach may still be flagged as spam if it’s unsolicited or promotional; follow anti-spam laws (e.g., CAN-SPAM) and best practices (truthful subject lines, no deceptive claims, no misleading familiarity).',
	'- Do not hallucinate facts; base all references on the provided context.',
	'',

	// SUBJECT LINE RULES
	'Subject line rules:',
	'- If the Subject field above is provided and not blank, use it exactly as the subject for the initial email ONLY.',
	'- For each follow-up email, ALWAYS generate a NEW, personalized subject (do not reuse the initial subject).',
	'- If the Subject field above is missing/blank for the initial email, generate a short subject (1–8 words), under 50 characters, that reflects personalization and matches the selected tone.',
	'- For all generated subjects (initial when blank + every follow-up): include either the company name or a concrete signal/pain point/benefit from the context.',
	'- Avoid generic subjects like “Quick question”, “A brief question”, “Hello”, “Following up”.',
	'- Avoid question marks and exclamation points in subjects.',
	'- Do NOT add reply/forward prefixes such as “Re:” or “Fwd:”.',
	'',

	// DELIVERY GUIDELINES
	'Important delivery guidelines:',
	'- Avoid common spam trigger words and phrases (exaggerated financial promises, urgent pressure like “limited time”, generic greetings, and words like “free” or “100% guaranteed”).',
	'- Keep copy realistic and honest; do not promise unrealistic outcomes or over-the-top benefits.',
	'- Do not use ALL CAPS or excessive punctuation.',
	'- Limit hyperlinks: include no more than two links (including the signature) in each email, and avoid large images or attachments.',
	'- Do not invent links, domains, addresses, or case studies. Only include a link if it is explicitly provided in the inputs; otherwise, include no links.',
	'- Keep each email concise: the initial email should be about {copy_length} words; follow-ups must be shorter.',
	'- Keep grammar and spelling correct.',
	'- Ensure the email feels personal and genuine, not overly promotional.',
	'',

	// OUTPUT FORMAT
	'Output format:',
	'- Return plain text only (no JSON, no markdown).',
	'- For each email (initial and follow-ups), begin with a line: Subject: <subject text>.',
	'- Then a blank line, then the email body.',
	'- Separate each email with a blank line.',
]
	.join('\n');

function buildDeepSeekPrompt({
	firstName,
	lastName,
	company,
	website,
	scrapedContent,
	serviceFocus,
}) {
	const recipientName = [firstName, lastName].filter(Boolean).join(' ').trim();

	const ourServices = (serviceFocus || config.defaultServicesContext || '').trim();
	const peakLead = String(config.peakLeadServicesContext || '').trim();

	return [
		'Task: Write a high-performing B2B cold email that is concise, personalized, and NOT spammy.',
		'',
		'Inputs',
		`- Recipient name: ${recipientName || ''}`,
		`- Recipient company: ${company || ''}`,
		`- Website input (may be missing or expired): ${String(website || '').trim()}`,
		`- Website insights (scraped, may be noisy): ${String(scrapedContent || '').trim()}`,
		`- Our company name: ${config.ourCompanyName}`,
		ourServices ? `- Our services (primary): ${ourServices}` : null,
		peakLead ? `- Additional services context (secondary): ${peakLead}` : null,
		'',
		'Rules (follow strictly)',
		'0) Always personalize the first line: if a first name is provided, the opening_line MUST start with “{firstName}, ” (example: “Jeffery, …”).',
		'1) Personalization (context over praise): pick the BEST 1–2 concrete signals from the website insights (e.g., niche, offer, ICP, pricing/demo language, hiring/expansion). Use them in the opening line. Do not mention “I saw your website”. Do not flatter them.',
		'1c) Prospect-first opening: opening_line should NOT start with what we do or who we are (no “We help…”, “I’m with…”, “Our company…”). Start with the prospect’s situation/goal implied by the signal.',
		'1b) Subject MUST be personalized: include either the company name OR a concrete website signal (category/niche/offer). Avoid generic subjects like “Quick question”.',
		'2) No hallucinations: do NOT invent facts, customers, metrics, locations, or tech stack. If website insights are weak/empty, do NOT guess what they do. Use the company name and a general outbound/lead-gen pain instead.',
		'2b) If website insights are weak/empty, opening_line should still start with the first name and reference the company name (not their industry). Example: “Jeffery, quick question about how Kypreos Group is finding new projects this quarter.”',
		'3) Value: connect the website signal to ONE plausible pain point and ONE clear benefit tied to our services. Avoid feature lists.',
		'3b) No generic capability lines: do NOT write generic sentences like “VikiLeads specializes in…” or “We help teams like yours…”.',
		'3c) Instead, include ONE concrete “what we deliver + why it matters” sentence in the email_body. Format: deliverable → outcome. Example: “We can build a verified list of the right roles at the right companies, so your team spends less time researching and more time selling.”',
		'4) Brevity: total email must be 55–90 words. Max 3 short paragraphs. Short sentences.',
		'5) Simple English: write in easy, clear words (grade ~6–8). Avoid uncommon words, idioms, and overly formal phrasing.',
		'6) Tone: conversational but professional (like talking to a smart colleague). Use contractions when natural. No hype. No exclamation marks. No emojis.',
		'6) Anti-spam: no ALL CAPS, avoid excessive punctuation (!!!, ???), and avoid spam-trigger language or hype.',
		'6a) Spam words to avoid: free, guarantee/guaranteed, best, cheapest, act now, limited time, urgent, winner, risk-free, no-obligation, click here, buy now, 100%, $$$, unbelievable.',
		'6b) Value-first: include one helpful, relevant insight/suggestion tied to the website signal (not just a pitch).',
		'6c) Cold outreach may still be flagged as spam; follow anti-spam best practices (truthful subject, no deceptive claims).',
		'6b) Approved proof points (optional, use at most ONE, and don’t add new numbers): 97% data accuracy, 50+ data sources, 10M+ contacts delivered, 500+ clients.',
		'7) CTA must appear ONLY once: do NOT include the CTA question inside opening_line or email_body. Put the question only in the cta field.',
		'8) CTA wording: do NOT always use “call”, “chat”, or “meeting”. Prefer neutral options like: “Open to 10 minutes next week?”, “Worth exploring?”, “Should I send 2 examples?”, or “Is this relevant for you?” Choose ONE.',
		'9) Output format: JSON only. No markdown. No extra keys. Use double quotes. Escape newlines as \\n inside strings.',
		'',
		'Output JSON schema (required keys)',
		'{',
		'  "subject": "(3–6 words; must include company name OR a concrete website signal; no hype)",',
		'  "opening_line": "(1 sentence; MUST start with recipient first name if provided; uses a specific website signal)",',
		'  "email_body": "(55–90 words total, 2–3 short paragraphs; do not repeat the opening_line verbatim; MUST NOT contain the CTA question)",',
		'  "cta": "(ONE question only; do not repeat; avoid always using call/chat/meeting)"',
		'}',
	]
		.filter(Boolean)
		.join('\n');
}

module.exports = { buildDeepSeekPrompt, COLD_EMAIL_PROMPT_WITH_FOLLOW_UP_TEMPLATE };
