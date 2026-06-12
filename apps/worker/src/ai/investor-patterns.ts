import type { SealedEnvelope } from '@repo/crypto';
import {
	getDealsByContact,
	isFeatureEnabled,
	listDealParticipants,
	listKnowledgeByContact,
	type UpsertInvestorProfileData,
	upsertInvestorProfile,
} from '@repo/db';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DealRow {
	id: string;
	stage: string;
	value: number | null;
	contactId: string;
	createdAt: string | Date;
	closedAt?: string | Date | null;
	stageHistory: unknown;
}

// ─── 1. computeAvgCycle ───────────────────────────────────────────────────────

/**
 * Average days from deal created → closed (won or lost).
 * Only counts deals that have reached a terminal stage.
 * Returns null when no closed deals exist.
 */
export function computeAvgCycle(deals: DealRow[]): number | null {
	const closedDeals = deals.filter((d) => (d.stage === 'won' || d.stage === 'lost') && d.closedAt);
	if (closedDeals.length === 0) return null;

	let totalDays = 0;
	for (const deal of closedDeals) {
		const created = new Date(deal.createdAt).getTime();
		const closed = new Date(deal.closedAt as string | Date).getTime();
		totalDays += (closed - created) / (24 * 60 * 60 * 1000);
	}
	return Math.round(totalDays / closedDeals.length);
}

// ─── 2. computePreferredRole ──────────────────────────────────────────────────

/**
 * Most frequent participant role for a contact across all their deals.
 * Returns null when no participant records exist.
 * Result is a role label (e.g., "co_investor") — no PII.
 */
export async function computePreferredRole(
	workspaceId: string,
	deals: DealRow[],
	envelope: SealedEnvelope,
): Promise<string | null> {
	const roleCounts = new Map<string, number>();

	for (const deal of deals) {
		try {
			const participants = await listDealParticipants(workspaceId, deal.id, envelope);
			for (const p of participants) {
				if (p.role) {
					roleCounts.set(p.role, (roleCounts.get(p.role) ?? 0) + 1);
				}
			}
		} catch {
			// Per-deal errors are non-fatal
		}
	}

	if (roleCounts.size === 0) return null;

	let topRole: string | null = null;
	let topCount = 0;
	for (const [role, count] of roleCounts) {
		if (count > topCount) {
			topCount = count;
			topRole = role;
		}
	}
	return topRole;
}

// ─── 3. computeSectorFocus ────────────────────────────────────────────────────

/**
 * Sector and topic labels from the contact's knowledge nodes.
 * Returns a deduplicated list of category labels — no PII.
 */
export async function computeSectorFocus(
	workspaceId: string,
	contactId: string,
	envelope: SealedEnvelope,
): Promise<string[]> {
	try {
		const nodes = await listKnowledgeByContact(contactId, workspaceId, envelope);
		const labels = nodes
			.filter((n) => n.type === 'sector' || n.type === 'topic')
			.map((n) => n.name.toLowerCase());
		return [...new Set(labels)];
	} catch {
		return [];
	}
}

// ─── 4. computeTicketRange ────────────────────────────────────────────────────

/**
 * Min and max deal value across closed-won deals.
 * Returns null for both when no won deals with a value exist.
 */
export function computeTicketRange(deals: DealRow[]): { min: number | null; max: number | null } {
	const wonValues = deals
		.filter((d) => d.stage === 'won' && d.value != null && d.value > 0)
		.map((d) => d.value as number);

	if (wonValues.length === 0) return { min: null, max: null };
	return {
		min: Math.min(...wonValues),
		max: Math.max(...wonValues),
	};
}

// ─── 5. computeCoInvestors ────────────────────────────────────────────────────

/**
 * Contact IDs who frequently co-invest alongside this contact
 * (appear as co_investor in the same deals, 2+ deals together).
 * Contacts are returned as raw IDs — callers who display names must
 * decrypt contact records separately.
 */
export async function computeCoInvestors(
	workspaceId: string,
	contactId: string,
	deals: DealRow[],
	envelope: SealedEnvelope,
): Promise<string[]> {
	const coInvestorCounts = new Map<string, number>();

	for (const deal of deals) {
		try {
			const participants = await listDealParticipants(workspaceId, deal.id, envelope);
			for (const p of participants) {
				if (p.contactId !== contactId && p.role === 'co_investor') {
					coInvestorCounts.set(p.contactId, (coInvestorCounts.get(p.contactId) ?? 0) + 1);
				}
			}
		} catch {
			// Per-deal errors are non-fatal
		}
	}

	// Return contacts who co-invested in 2+ deals
	return [...coInvestorCounts.entries()]
		.filter(([, count]) => count >= 2)
		.sort(([, a], [, b]) => b - a)
		.map(([id]) => id);
}

// ─── 6. computeActivityTrend ──────────────────────────────────────────────────

const TREND_RECENT_WINDOW_DAYS = 30;
const TREND_OLDER_WINDOW_DAYS = 90;

/**
 * Determine deal velocity trend: heating_up / steady / cooling_down.
 *
 * Compares deal creation count in the last 30 days vs 30–90 days ago.
 * - heating_up:   recent > older × 1.5
 * - cooling_down: recent < older × 0.5
 * - steady:       otherwise
 *
 * Returns 'steady' when there's not enough data.
 */
export function computeActivityTrend(deals: DealRow[]): 'heating_up' | 'steady' | 'cooling_down' {
	const now = Date.now();
	const recentCutoff = now - TREND_RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
	const olderCutoff = now - TREND_OLDER_WINDOW_DAYS * 24 * 60 * 60 * 1000;

	const recentCount = deals.filter((d) => {
		const created = new Date(d.createdAt).getTime();
		return created >= recentCutoff;
	}).length;

	const olderCount = deals.filter((d) => {
		const created = new Date(d.createdAt).getTime();
		return created >= olderCutoff && created < recentCutoff;
	}).length;

	if (olderCount === 0) return 'steady';
	const ratio = recentCount / olderCount;

	if (ratio >= 1.5) return 'heating_up';
	if (ratio <= 0.5) return 'cooling_down';
	return 'steady';
}

// ─── Compose: computeInvestorProfile ─────────────────────────────────────────

/**
 * Full investor profile computation pipeline for a single contact.
 *
 * Runs all 6 functions, collects results, then upserts into investor_profiles.
 * Feature-flag gated: `investor_profiles` must be enabled.
 * Graceful degradation: errors in individual computations do not abort the run.
 */
export async function computeInvestorProfile(
	workspaceId: string,
	contactId: string,
	envelope: SealedEnvelope,
): Promise<void> {
	const enabled = await isFeatureEnabled('investor_profiles', workspaceId);
	if (!enabled) {
		console.log('[investor-patterns] Feature flag off \u2014 skipping');
		return;
	}

	let deals: DealRow[];
	try {
		deals = (await getDealsByContact(workspaceId, contactId, envelope)) as DealRow[];
	} catch (err) {
		console.error(
			`[investor-patterns] Failed to fetch deals for contact=${contactId.slice(0, 8)}:`,
			(err as Error).message,
		);
		return;
	}

	const [preferredRole, sectorFocus, _coInvestors] = await Promise.all([
		computePreferredRole(workspaceId, deals, envelope),
		computeSectorFocus(workspaceId, contactId, envelope),
		computeCoInvestors(workspaceId, contactId, deals, envelope),
	]);

	const avgCycleDays = computeAvgCycle(deals);
	const { min: ticketMin, max: ticketMax } = computeTicketRange(deals);
	const activityTrend = computeActivityTrend(deals);

	const wonDeals = deals.filter((d) => d.stage === 'won');
	const dealCount = deals.length;
	const winRate = dealCount > 0 ? wonDeals.length / dealCount : 0;

	const data: UpsertInvestorProfileData = {
		dealCount,
		winRate,
		avgCycleDays: avgCycleDays ?? undefined,
		preferredRole,
		sectorFocus: sectorFocus.length > 0 ? sectorFocus : null,
		ticketMin,
		ticketMax,
		tokenInterests: sectorFocus.filter((s) => s.includes('token') || s.includes('coin')),
		activityTrend,
	};

	await upsertInvestorProfile(workspaceId, contactId, data);

	console.log(
		`[investor-patterns] Profile updated for contact=${contactId.slice(0, 8)} workspace=${workspaceId.slice(0, 8)}: trend=${activityTrend} deals=${dealCount} winRate=${(winRate * 100).toFixed(0)}%`,
	);
}
