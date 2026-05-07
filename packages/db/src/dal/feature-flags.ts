import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../client';
import { featureFlags } from '../schema/feature-flags';

// ---- In-memory cache ----
interface CacheEntry {
	value: boolean;
	expiresAt: number;
}

const FLAG_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

function resolvedKey(key: string, workspaceId?: string): string {
	return workspaceId ? `${key}::resolved::${workspaceId}` : `${key}::resolved::__global__`;
}

/** Clear the in-memory flag cache. Exported for testing. */
export function clearFlagCache(): void {
	FLAG_CACHE.clear();
}

// ---- DAL functions ----

/**
 * Check if a feature is enabled.
 * Resolution: workspace-specific > global > false (fail-closed).
 */
export async function isFeatureEnabled(key: string, workspaceId?: string): Promise<boolean> {
	const rk = resolvedKey(key, workspaceId);
	const cached = FLAG_CACHE.get(rk);
	if (cached && Date.now() <= cached.expiresAt) {
		return cached.value;
	}

	// 1. Try workspace-specific flag
	if (workspaceId) {
		const wsFlag = await db
			.select({ enabled: featureFlags.enabled })
			.from(featureFlags)
			.where(and(eq(featureFlags.key, key), eq(featureFlags.workspaceId, workspaceId)))
			.limit(1);

		if (wsFlag[0] !== undefined) {
			const value = wsFlag[0].enabled;
			FLAG_CACHE.set(rk, { value, expiresAt: Date.now() + CACHE_TTL_MS });
			return value;
		}
	}

	// 2. Fall back to global flag
	const globalFlag = await db
		.select({ enabled: featureFlags.enabled })
		.from(featureFlags)
		.where(and(eq(featureFlags.key, key), isNull(featureFlags.workspaceId)))
		.limit(1);

	const value = globalFlag[0]?.enabled ?? false; // 3. Default: fail-closed
	FLAG_CACHE.set(rk, { value, expiresAt: Date.now() + CACHE_TTL_MS });
	return value;
}

/**
 * Upsert a feature flag. Pass workspaceId = undefined for global flags.
 */
export async function setFeatureFlag(
	key: string,
	enabled: boolean,
	workspaceId?: string,
	updatedBy?: string,
): Promise<void> {
	await db
		.insert(featureFlags)
		.values({
			key,
			enabled,
			workspaceId: workspaceId ?? null,
			updatedBy: updatedBy ?? null,
			updatedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: workspaceId ? [featureFlags.key, featureFlags.workspaceId] : [featureFlags.key],
			set: {
				enabled,
				updatedBy: updatedBy ?? null,
				updatedAt: new Date(),
			},
			setWhere: workspaceId ? undefined : isNull(featureFlags.workspaceId),
		});

	// Invalidate cache for this key
	for (const [k] of FLAG_CACHE) {
		if (k.startsWith(`${key}::`)) {
			FLAG_CACHE.delete(k);
		}
	}
}

/**
 * List all flags visible to a workspace (global + workspace-specific).
 */
export async function listFeatureFlags(workspaceId?: string) {
	if (workspaceId) {
		const { sql } = await import('drizzle-orm');
		return db
			.select()
			.from(featureFlags)
			.where(
				sql`${featureFlags.workspaceId} = ${workspaceId} OR ${featureFlags.workspaceId} IS NULL`,
			)
			.orderBy(featureFlags.key);
	}
	return db
		.select()
		.from(featureFlags)
		.where(isNull(featureFlags.workspaceId))
		.orderBy(featureFlags.key);
}

/**
 * Delete a feature flag by key and optional workspace scope.
 */
export async function deleteFeatureFlag(key: string, workspaceId?: string): Promise<void> {
	if (workspaceId) {
		await db
			.delete(featureFlags)
			.where(and(eq(featureFlags.key, key), eq(featureFlags.workspaceId, workspaceId)));
	} else {
		await db
			.delete(featureFlags)
			.where(and(eq(featureFlags.key, key), isNull(featureFlags.workspaceId)));
	}

	// Invalidate cache
	for (const [k] of FLAG_CACHE) {
		if (k.startsWith(`${key}::`)) {
			FLAG_CACHE.delete(k);
		}
	}
}
