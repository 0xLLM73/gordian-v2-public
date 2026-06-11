const DEFAULT_LOCAL_AI_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_LOCAL_AI_OLLAMA_KEEP_ALIVE = '1m';

function positiveIntegerEnv(name: string, fallback: number, env: NodeJS.ProcessEnv): number {
	const parsed = Number(env[name]);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function localAiRequestTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
	return positiveIntegerEnv(
		'LOCAL_AI_REQUEST_TIMEOUT_MS',
		DEFAULT_LOCAL_AI_REQUEST_TIMEOUT_MS,
		env,
	);
}

export function localOllamaKeepAlive(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const raw = env.LOCAL_AI_OLLAMA_KEEP_ALIVE?.trim();
	if (raw === 'default') return undefined;
	return raw || DEFAULT_LOCAL_AI_OLLAMA_KEEP_ALIVE;
}

export function withOllamaKeepAlive<TBody extends Record<string, unknown>>(
	body: TBody,
	env: NodeJS.ProcessEnv = process.env,
): TBody & { keep_alive?: string } {
	const keepAlive = localOllamaKeepAlive(env);
	return keepAlive ? { ...body, keep_alive: keepAlive } : body;
}

export async function fetchLocalModel(
	input: string | URL,
	init: RequestInit,
	options: { label: string; timeoutMs?: number },
): Promise<Response> {
	const timeoutMs = options.timeoutMs ?? localAiRequestTimeoutMs();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		return await fetch(input, { ...init, signal: controller.signal });
	} catch (error) {
		if (controller.signal.aborted) {
			throw new Error(`${options.label} timed out after ${Math.round(timeoutMs / 1000)}s`);
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}
