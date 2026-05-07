import { build } from 'esbuild';

// Bundle the main entry point and the GramJS worker thread separately
await Promise.all([
	build({
		entryPoints: ['src/index.ts'],
		bundle: true,
		platform: 'node',
		target: 'node20',
		format: 'esm',
		outdir: 'dist',
		sourcemap: true,
		external: [
			// Native Node modules
			'node:*',
			// Packages that don't bundle well or use native addons
			'bufferutil',
			'utf-8-validate',
			'msgpackr-extract',
		],
		banner: {
			// Shim require() for CJS dependencies in ESM bundle
			js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
		},
	}),
	build({
		entryPoints: ['src/gramjs/gramjs-worker.ts'],
		bundle: true,
		platform: 'node',
		target: 'node20',
		format: 'esm',
		outdir: 'dist/gramjs',
		sourcemap: true,
		external: ['node:*', 'bufferutil', 'utf-8-validate'],
		banner: {
			js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
		},
	}),
]);

console.log('Build complete');
