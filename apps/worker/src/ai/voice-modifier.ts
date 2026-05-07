/**
 * Voice Modifier — Converts StyleFeatures → natural language prompt string
 *
 * Injected between DRAFT_SYSTEM_KERNEL and ARM_INSTRUCTIONS in draft generation.
 * The bandit controls *what to say*; this controls *how it sounds*.
 *
 * Security:
 * - dominantTone validated against Set allowlist (prevents prompt injection)
 * - emojiTopN Zod-parsed + per-char validated (prevents non-emoji content)
 */

import { z } from 'zod';

// ── Security Allowlists ────────────────────────────────────────────────

const ALLOWED_TONES = new Set(['casual', 'professional', 'warm', 'terse']);

// [SEC-FIX MED-2] Zod schema for runtime validation of emojiTopN JSONB
const emojiTopNSchema = z.array(
	z.object({
		emoji: z.string(),
		count: z.number(),
	}),
);

// [SEC-FIX HIGH-1] Validate emoji is actually a Unicode emoji
const EMOJI_CHAR_REGEX = /^\p{Emoji_Presentation}$/u;

// ── Types ──────────────────────────────────────────────────────────────

export interface VoiceProfile {
	avgWordCount: number;
	contractionRate: number;
	emojiRate: number;
	emojiTopN: unknown; // JSONB — runtime validated
	exclamationRate: number;
	greetingRate: number;
	slangRate: number;
	fillerWordRate: number;
	sampleSize: number;
	profileVersion: number;
	calibrationComplete: boolean;
	// AI-analyzed rich fields (Gemini Flash) — optional, backward compatible
	richSummary?: string | null;
	richTone?: string | null;
	richStructure?: string | null;
	codeSwitchingSummary?: string | null;
}

export interface ContactOverride {
	lengthMultiplier: number;
	formalityShift: number;
	emojiMultiplier: number;
	dominantTone: string;
	sampleSize: number;
}

// ── Builder ────────────────────────────────────────────────────────────

export function buildVoiceModifier(
	profile: VoiceProfile | null,
	override?: ContactOverride | null,
): { modifier: string; profileVersion: number | null } {
	if (!profile || (profile.sampleSize < 20 && !profile.calibrationComplete)) {
		return { modifier: '', profileVersion: profile?.profileVersion ?? null };
	}

	// When rich AI-analyzed fields are available, prefer them over numeric heuristics
	if (profile.richSummary) {
		const lines: string[] = ["\n\nVoice Profile (match the user's writing style):"];

		// Sanitize rich fields: max 500 chars, strip angle brackets
		const sanitize = (s: string | null | undefined, max = 300): string =>
			(s ?? '').replace(/[<>]/g, '').slice(0, max).trim();

		lines.push(`- Style summary: ${sanitize(profile.richSummary, 500)}`);
		if (profile.richTone) lines.push(`- Tone: ${sanitize(profile.richTone)}`);
		if (profile.richStructure) lines.push(`- Structure: ${sanitize(profile.richStructure)}`);
		if (profile.codeSwitchingSummary) {
			lines.push(`- Adaptation: ${sanitize(profile.codeSwitchingSummary)}`);
		}

		// Still include numeric emoji guidance (more precise than LLM description)
		if (profile.emojiRate > 0.5) {
			const parsed = emojiTopNSchema.safeParse(profile.emojiTopN);
			if (parsed.success) {
				const validEmojis = parsed.data
					.filter((e) => EMOJI_CHAR_REGEX.test(e.emoji))
					.slice(0, 5)
					.map((e) => e.emoji)
					.join(' ');
				if (validEmojis.length > 0) {
					lines.push(`- Preferred emojis: ${validEmojis}`);
				}
			}
		} else if (profile.emojiRate < 0.1) {
			lines.push('- Do not use emojis');
		}

		// Contact-specific override still applies
		if (override && override.sampleSize >= 10) {
			const tone = ALLOWED_TONES.has(override.dominantTone) ? override.dominantTone : 'casual';
			lines.push(`- With this specific contact, tone is typically: ${tone}`);
			if (override.lengthMultiplier > 1.3) {
				lines.push('- Messages to this contact tend to be longer than average');
			} else if (override.lengthMultiplier < 0.7) {
				lines.push('- Messages to this contact tend to be shorter than average');
			}
		}

		return { modifier: lines.join('\n'), profileVersion: profile.profileVersion };
	}

	// Fallback: numeric heuristics (no rich profile available)
	const lines: string[] = ["\n\nVoice Profile (match the user's writing style):"];

	// Message length guidance
	const targetWords = Math.round(profile.avgWordCount);
	if (targetWords > 0) {
		lines.push(`- Target message length: approximately ${targetWords} words`);
	}

	// Contraction usage
	if (profile.contractionRate > 0.5) {
		lines.push("- Use contractions freely (don't, can't, I'm, won't)");
	} else if (profile.contractionRate < 0.2) {
		lines.push('- Avoid contractions — use full forms (do not, cannot)');
	}

	// Emoji usage — [SEC-FIX HIGH-1 + MED-2] validated before injection
	if (profile.emojiRate > 0.5) {
		const parsed = emojiTopNSchema.safeParse(profile.emojiTopN);
		if (parsed.success) {
			const validEmojis = parsed.data
				.filter((e) => EMOJI_CHAR_REGEX.test(e.emoji))
				.slice(0, 5)
				.map((e) => e.emoji)
				.join(' ');
			if (validEmojis.length > 0) {
				lines.push(`- Include emojis naturally — preferred: ${validEmojis}`);
			}
		}
	} else if (profile.emojiRate < 0.1) {
		lines.push('- Do not use emojis');
	}

	// Exclamation style
	if (profile.exclamationRate > 0.4) {
		lines.push('- Use exclamation marks for enthusiasm');
	} else if (profile.exclamationRate < 0.1) {
		lines.push('- Avoid exclamation marks');
	}

	// Greeting style
	if (profile.greetingRate < 0.1) {
		lines.push('- Skip greetings — jump straight to the point');
	} else if (profile.greetingRate > 0.5) {
		lines.push('- Start with a greeting (hey, hi)');
	}

	// Slang
	if (profile.slangRate > 0.15) {
		lines.push('- Informal language is fine (lol, tbh, ngl)');
	}

	// Filler words
	if (profile.fillerWordRate > 0.03) {
		lines.push('- Natural filler words are okay (just, like, actually)');
	}

	// Contact-specific override — [SEC-FIX HIGH-1] dominantTone validated
	if (override && override.sampleSize >= 10) {
		const tone = ALLOWED_TONES.has(override.dominantTone) ? override.dominantTone : 'casual';
		lines.push(`- With this specific contact, tone is typically: ${tone}`);
		if (override.lengthMultiplier > 1.3) {
			lines.push('- Messages to this contact tend to be longer than average');
		} else if (override.lengthMultiplier < 0.7) {
			lines.push('- Messages to this contact tend to be shorter than average');
		}
	}

	return {
		modifier: lines.join('\n'),
		profileVersion: profile.profileVersion,
	};
}
