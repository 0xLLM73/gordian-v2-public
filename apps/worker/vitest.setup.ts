import { vi } from 'vitest';

// Global mock: withRLS is a passthrough in tests — the RLS middleware
// just returns the processor unchanged so tests don't need to mock @repo/db's withWorkspaceRLS.
vi.mock('./src/middleware/rls', () => ({
	withRLS: (processor: unknown) => processor,
}));
