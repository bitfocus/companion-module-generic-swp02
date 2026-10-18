import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.spec.ts'],
		coverage: {
			provider: 'v8',
			// text for the CI log, lcov for Codecov, html for browsing locally
			reporter: ['text', 'lcov', 'html'],
			reportsDirectory: './coverage',
			include: ['src/**/*.ts'],
			exclude: [
				'src/**/*.spec.ts',
				// Test-only fake router and fixtures, not shipped code
				'src/__tests__/**',
			],
		},
	},
})
