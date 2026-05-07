import { Queue, Worker } from 'bullmq';
import { runKnowledgeInference } from '../ai/knowledge-inference';
import { withRLS } from '../middleware/rls';
import { connection } from '../redis';

export const knowledgeInferenceQueue = new Queue('knowledge-inference', {
	connection,
	prefix: '{ai-flow}',
});

export const knowledgeInferenceWorker = new Worker(
	'knowledge-inference',
	withRLS(async (job) => {
		const { workspaceId } = job.data as { workspaceId: string };
		console.log(`[knowledge-inference] Processing for workspace=${workspaceId.slice(0, 8)}`);
		await runKnowledgeInference(workspaceId);
	}),
	{ connection, prefix: '{ai-flow}', concurrency: 1 },
);

knowledgeInferenceWorker.on('failed', (job, err) => {
	console.error(`[knowledge-inference] Job ${job?.id} failed:`, err.message);
});

/**
 * Enqueue a knowledge inference run for a workspace.
 * Idempotent: jobId deduplicates concurrent requests per workspace.
 */
export async function scheduleKnowledgeInference(workspaceId: string): Promise<void> {
	await knowledgeInferenceQueue.add(
		'run-inference',
		{ workspaceId },
		{ jobId: `ki-${workspaceId}` },
	);
}
