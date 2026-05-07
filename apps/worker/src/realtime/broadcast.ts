import { type SupabaseClient, createClient } from '@supabase/supabase-js';

/**
 * Supabase Realtime Broadcast integration (followup3).
 * Worker acts as "Decryption Gateway" — decrypts/sanitizes data
 * BEFORE broadcasting to clients.
 *
 * WARNING: NEVER use Supabase Realtime Postgres Changes (CDC).
 * CDC sends raw database changes which are ciphertext for encrypted fields.
 * Use Broadcast mode where the worker sends already-decrypted data (ERR-012).
 */

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
	if (!supabase) {
		const supabaseUrl = process.env.SUPABASE_URL;
		const serviceKey = process.env.SUPABASE_SERVICE_KEY;
		if (!supabaseUrl || !serviceKey) {
			throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required for Realtime broadcast');
		}
		supabase = createClient(supabaseUrl, serviceKey);
	}
	return supabase;
}

/**
 * Broadcast a real-time update to a workspace channel.
 * Payload should already be decrypted/sanitized by the worker.
 */
export async function broadcastUpdate(
	workspaceId: string,
	event: string,
	payload: Record<string, unknown>,
): Promise<void> {
	const client = getSupabase();
	const channel = client.channel(`workspace:${workspaceId}`);

	await channel.send({
		type: 'broadcast',
		event,
		payload, // Already decrypted/sanitized by worker
	});

	// Unsubscribe after sending (we're the producer, not consumer)
	client.removeChannel(channel);
}

/**
 * Buffer & Flush pattern for batch sync (followup3).
 * Instead of broadcasting 1000 individual message events,
 * send a single 'telegram-sync-batch' event with summary.
 */
export async function broadcastSyncComplete(
	workspaceId: string,
	summary: { newMessages: number; newContacts: number },
): Promise<void> {
	await broadcastUpdate(workspaceId, 'telegram-sync-batch', summary);
}

/**
 * Broadcast a contact update notification (ID only — no PII, SEC-027).
 * Client fetches full contact data via authenticated API after receiving this event.
 */
export async function broadcastContactUpdate(
	workspaceId: string,
	contactId: string,
): Promise<void> {
	await broadcastUpdate(workspaceId, 'contact-updated', { id: contactId });
}

/** Per-contact insight for sync feed narrative */
interface ContactProcessedEvent {
	name: string;
	lastMessageAt: string;
	messageCount: number;
}

/** Stale contact for ghosting alert */
interface StaleContactEvent {
	id: string;
	firstName: string | null;
	lastName: string | null;
	lastMessageAt: string | null;
	messageCount: number;
}

/**
 * Broadcast sync progress events for the onboarding processing page.
 * Sends intermediate counts so the UI can show real-time progress.
 * Extended for Track D: contactProcessed (per-contact narrative) and staleContacts (ghosting alert).
 */
export async function broadcastSyncProgress(
	workspaceId: string,
	progress: {
		contacts: number;
		messages: number;
		stage: string;
		contactProcessed?: ContactProcessedEvent;
		staleContacts?: StaleContactEvent[];
	},
): Promise<void> {
	await broadcastUpdate(workspaceId, 'sync-progress', progress);
}
