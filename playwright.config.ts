import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;

export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: true,
	workers: 4,
	forbidOnly: !!process.env.CI,
	retries: 1,
	reporter: [['list']],
	webServer: {
		command: 'node app.cjs',
		port: PORT,
		env: { PORT: String(PORT), HOST: '127.0.0.1' },
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	},
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		locale: 'de-DE',
		trace: 'retain-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
});
