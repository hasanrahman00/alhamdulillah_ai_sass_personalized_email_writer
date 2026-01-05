const { config } = require('../config');

// Template for the Bulk Copy flow (placeholder-based, supports optional follow-ups).
// Same as COLD_EMAIL_PROMPT_WITH_FOLLOW_UP_TEMPLATE, except it does NOT include sender placeholders.
// Sender details are fixed for the whole job and injected here from config.
const COLD_EMAIL_BULK_PROMPT_WITH_FOLLOW_UP_TEMPLATE = [
	// ROLE & SETTINGS
	'You are an experienced B2B email copywriter.',
	'Based on the information provided, generate a {copy_length}-word cold email in a {tone_type} tone.',
	'Tone guidance (follow this exactly): {tone_guidance}.',
	'Follow-up count: {follow_up_count}. If follow-up count > 0, also generate that many follow-up emails to send after the initial email.',
	'CRITICAL: You MUST output exactly 1 initial email + exactly {follow_up_count} follow-up emails (no more, no fewer). Do not skip any email.',
	'Each follow-up should build on the previous message, be shorter than the last, and keep the overall tone consistent while becoming slightly more direct toward the final follow-up.',
	'Length targets (IMPORTANT): Initial ≈ {copy_length} words. Follow-ups MUST be shorter than the initial AND shorter than the previous follow-up. Target ranges: Follow-up 1 ≈ 60–75% of initial, Follow-up 2 ≈ 45–60%, Follow-up 3 ≈ 35–50% (only when follow_up_count >= 4), Final follow-up (the last one) ≈ 25–35%.',
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

	'Subject (optional): {subject}',
	'',
	'Additional instructions (optional): {additional_instructions}',
	'',

	// WRITING GUIDELINES
	'Write a concise, natural-sounding cold email addressed to {recipient_first_name} that:',
	'• Starts with “Hi {recipient_first_name},\\n” or “Hi,\\n” if the first name is missing.',
	'• CRITICAL formatting: plain text only. Use real newlines. Do NOT use HTML tags like <br> or <p>. Separate paragraphs using a blank line (\\n\\n).',
	'• Paragraph rule for the INITIAL email body: EXACTLY 3 short paragraphs (each 1–2 sentences), separated by a blank line.',
	'• Uses a short subject line (1–8 words) that is clear, specific, and personal; keep it under 50 characters. Include either the company name or a concrete pain point/benefit. Avoid question marks and exclamation points.',
	'• Opens with a hook referencing the prospect’s current situation or goal (e.g., a launch, hiring, expansion) and does not mention your company first.',
	'• Follow this message flow in order: (1) personal hook; (2) why it matters to their role/pain; (3) value tease (how the offer helps); (4) soft CTA. Fit this flow into the 3-paragraph structure (no extra paragraphs).',
	'• Keeps language simple and conversational (grade 6–8). Avoid jargon and buzzwords. Use contractions when natural.',
	'• Uses buyer-focused language: use “you/your” more than “we/our”. Focus on their outcome (e.g., “reduce manual prospecting time”, “speed up onboarding”) rather than listing all your services.',
	'• Keep the value proposition to 1–2 sentences. Choose the single most relevant service or angle for the prospect’s context; do not list multiple services.',
	'• If the user provides proof (metrics, case studies), you may reference it briefly; do NOT invent stats, customers, logos, or results.',
	'• Use ONE clear call-to-action and at most ONE question in the entire email. Put any question only in the CTA line. Avoid question marks elsewhere.',
	'• CTA style: propose one low-friction next step in a conversational way (e.g., “Worth a quick 10-minute call to explore two ideas?” or “Should I send over a quick checklist?”). Avoid imperative language like “Book a call” or “Schedule a meeting.”',
	'• End after the CTA line (or a brief closing line) without adding a signature, separator (e.g. “---”) or sender details.',
	'• Adapt wording and directness to the selected tone ({tone_type}): keep the 4-line structure, but be slightly more direct for authoritative tones and slightly warmer for friendly tones.',
	'',

	// FOLLOW-UP GUIDELINES
	'For follow-up emails:',
	'• Begin with “Hi {recipient_first_name},\\n” (or “Hi,\\n” if missing) and briefly remind them of the previous message (no guilt, no pressure).',
	'• Paragraph rule for FOLLOW-UPS (STRICT): each paragraph must be a micro-paragraph (1 sentence, max 18 words). Separate paragraphs using a blank line (\\n\\n).',
	'  - If follow_up_count is 1 or 2: EVERY follow-up MUST be EXACTLY 2 micro-paragraphs.',
	'  - If follow_up_count is 3: Follow-up 1 and Follow-up 2 MUST be EXACTLY 2 micro-paragraphs; Follow-up 3 MUST be EXACTLY 1 micro-paragraph.',
	'  - If follow_up_count is 4 or more: all follow-ups except the FINAL follow-up MUST be EXACTLY 2 micro-paragraphs; the FINAL follow-up MUST be EXACTLY 1 micro-paragraph.',
	'• Use a NEW subject reflecting the specific NEW insight or value in that follow-up (3–6 words). It must feel like a natural continuation of the previous email, not a generic “checking in”.',
	'• Provide ONE new insight or suggestion tied to the initial extracted signals (e.g., a quick checklist, a best practice, or a careful industry benchmark). Do NOT introduce unrelated examples or hallucinate details. Do NOT just repeat the offer.',
	'• Keep each follow-up shorter than the last (at least ~20% shorter than the previous email). Become more direct by using fewer words and a clearer ask (NOT by adding pressure).',
	'• Avoid filler lines like “just following up” or “bumping this”. If you follow up, do it with either a new insight, a proof point, a helpful suggestion, or a timing check.',
	'• Stay polite and upbeat; respect the prospect’s time and avoid pushiness. Do not close the loop abruptly. If you want to wrap up, ask politely if it’s not a priority right now.',
	'',

	// LANGUAGE & CLARITY
	'Language & clarity rules:',
	'- Use plain English; avoid jargon and complex sentences.',
	'- Keep paragraphs and sentences short; avoid exclamation marks.',
	'- No emojis. No ALL CAPS. Avoid spam trigger words and phrases that create urgency (“urgent”, “limited time”), seem shady (“secret”, “risk-free”), overpromise outcomes (“guaranteed success”, “double your revenue”) or sound unnatural. The copy should feel honest and realistic.',
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
	'- Do NOT add ANY prefixes, tags, or external markers in subjects such as “Re:”, “Fwd:”, “FW:”, “RE -”, “[EXTERNAL]”, “[SPAM]”, “[SUSPICIOUS]”, or similar.',
	'- Subject must be plain text words only (no brackets/tags).',
	'',

	// DELIVERY GUIDELINES
	'Important delivery guidelines:',
	'- Avoid common spam trigger words and phrases (exaggerated financial promises, urgent pressure like “limited time”, generic greetings, and words like “free” or “100% guaranteed”).',
	'- Keep copy realistic and honest; do not promise unrealistic outcomes or over-the-top benefits.',
	'- Do not use ALL CAPS or excessive punctuation.',
	'- Limit hyperlinks: include no more than two links in each email, and avoid large images or attachments.',
	'- Do not invent links, domains, addresses, or case studies. Only include a link if it is explicitly provided in the inputs; otherwise, include no links.',
	'- Keep each email concise: the initial email should be about {copy_length} words; follow-ups must be shorter.',
	'- Keep grammar and spelling correct.',
	'- Ensure the email feels personal and genuine, not overly promotional.',
	'',

	// OUTPUT FORMAT
	'Output format:',
	'- Return plain text only (no JSON, no markdown).',
	'- IMPORTANT: For EACH email (initial and every follow-up), you MUST begin with a line exactly like: Subject: <subject text>.',
	'- Then a blank line, then the email body.',
	'- Separate each email with a blank line.',
	'- Output ONLY the emails. No commentary, no extra headings, no numbering.',
	'- Do NOT include any signature, sender name, sender title, company sign-off, or separator lines (e.g., no "---", no "Best," / "Regards," / "Sincerely,"). End after the CTA line (or one brief closing line).',
]
	.join('\n');

module.exports = { COLD_EMAIL_BULK_PROMPT_WITH_FOLLOW_UP_TEMPLATE };
