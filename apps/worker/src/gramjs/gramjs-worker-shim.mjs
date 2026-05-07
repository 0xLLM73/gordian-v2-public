// Bootstrapper for gramjs-worker.ts in dev mode.
// Worker threads don't inherit ESM hooks from the main thread,
// so we use tsx/esm/api to register the TypeScript loader.
import { register } from 'tsx/esm/api';
register();

// Now .ts files can be imported via ESM
await import('./gramjs-worker.ts');
