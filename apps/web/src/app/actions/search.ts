'use server';

import { getInternalSecret, workspaceAction } from '@/lib/safe-action';
import { track } from '@/lib/track';
import { unifiedSearch } from '@repo/db';
import { z } from 'zod';

// Generate embedding for semantic search via worker API
async function getQueryEmbedding(query: string): Promise<number[] | null> {
	// Short queries (likely name lookups) don't benefit from embeddings
	if (query.length < 10) return null;

	const workerUrl = process.env.WORKER_URL;
	if (!workerUrl) return null;

	try {
		const response = await fetch(`${workerUrl}/admin/embed`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': getInternalSecret(),
			},
			body: JSON.stringify({ text: query }),
		});
		if (!response.ok) return null;
		const data = (await response.json()) as { embedding: number[] };
		return data.embedding;
	} catch {
		return null;
	}
}

export const searchAction = workspaceAction
	.schema(
		z.object({
			query: z.string().min(1).max(200),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { query } = parsedInput;
		const { workspaceId, envelope } = ctx;
		if (!envelope) throw new Error('Workspace encryption key not found');

		const embedding = await getQueryEmbedding(query);
		track(workspaceId, ctx.session.user.id, 'search_contacts');
		return unifiedSearch(workspaceId, query, envelope, embedding);
	});
