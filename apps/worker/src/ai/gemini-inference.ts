import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Gemini Flash Inference Adapter (KG-3):
 * Thin adapter for Google Gemini API, targeting Gemini 2.0 Flash
 * for cost-efficient entity and rationale extraction.
 *
 * CRITICAL: All input text MUST be ELM-masked before calling inferWithGemini().
 * No plaintext PII should ever reach the Gemini API.
 *
 * Cost: Gemini 2.0 Flash at $0.10/M input vs Haiku at $1/M input (90% savings).
 */

const DEFAULT_MODEL = 'gemini-2.0-flash';

let _genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
	if (!_genAI) {
		const apiKey = process.env.GEMINI_API_KEY;
		if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
		_genAI = new GoogleGenerativeAI(apiKey);
	}
	return _genAI;
}

export async function inferWithGemini(params: {
	systemPrompt: string;
	userPrompt: string;
	model?: string;
}): Promise<string> {
	const client = getClient();
	const model = client.getGenerativeModel({
		model: params.model ?? DEFAULT_MODEL,
	});

	const result = await model.generateContent({
		systemInstruction: params.systemPrompt,
		contents: [{ role: 'user', parts: [{ text: params.userPrompt }] }],
	});

	return result.response.text();
}
