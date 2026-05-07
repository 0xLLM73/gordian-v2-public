/**
 * Re-export from @repo/crypto — canonical implementation moved there
 * so packages/db can also use it for golden dataset masking.
 */
import { prefilterEntities } from '@repo/crypto';

export { prefilterEntities };

/**
 * Check if text likely contains PII that needs masking.
 * Quick check to decide if we should run the full pipeline.
 */
export function containsLikelyPII(text: string): boolean {
	return prefilterEntities(text).length > 0;
}
