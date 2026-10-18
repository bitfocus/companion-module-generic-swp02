import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({
	enableTypescript: true,
	ignores: ['**/tests/*', 'vitest.config.ts'],
})

const customConfig = [
	...baseConfig,

	{
		rules: {
			//'@typescript-eslint/no-unsafe-enum-comparison': 'off',
			// misconfiguration of ts or something?
			'n/no-missing-import': 'off',
			'@typescript-eslint/no-empty-object-type': 'off',
			// 'm/no-unpublished-import': 'off',
			//'@typescript-eslint/no-unused-expressions': 'off',
			//'@typescript-eslint/no-floating-promises': 'off',
		},
	},
	{
		// Tests and their helpers, none of which are built into dist. The second pattern needs its own
		// `**` to reach helpers in a subfolder, such as src/__tests__/presets/helpers.ts
		files: ['src/**/*.spec.ts', 'src/**/__tests__/**/*.ts'],
		rules: {
			'n/no-unpublished-import': 'off',
		},
	},
]

export default customConfig
