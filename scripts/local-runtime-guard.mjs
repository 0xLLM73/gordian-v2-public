#!/usr/bin/env node

import { loadRootEnv } from './lib/load-root-env.mjs';
import {
	ALLOW_NONLOCAL_DEMO_TARGETS_ENV,
	assertLocalDemoTargets,
} from './lib/local-runtime-safety.mjs';

loadRootEnv();

try {
	assertLocalDemoTargets(process.env);
	console.log('Local demo target guard passed.');
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	console.error(
		`Refusing to continue. Set ${ALLOW_NONLOCAL_DEMO_TARGETS_ENV}=true only when intentionally targeting nonlocal services.`,
	);
	process.exitCode = 1;
}
