import { defineConfig } from '@playwright/test';

export default defineConfig({
	globalSetup: './e2e/fixtures/auth',
	testDir: './e2e',
	timeout: 90000,
	workers: 1,
	retries: 0,
	use: {
		baseURL: 'http://localhost:3456',
		headless: true,
	},
	webServer: {
		command: 'pnpm dev --port 3456',
		port: 3456,
		reuseExistingServer: true,
		timeout: 60000,
	},
	projects: [
		{
			name: 'chromium',
			use: { browserName: 'chromium' },
		},
	],
});
