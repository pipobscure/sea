module.exports = {
	extends: ['prettier'],
	ignorePatterns: ['/*', '!/src/'],
	parser: '@typescript-eslint/parser',
	parserOptions: { project: ['./tsconfig.json'] },
	plugins: ['prettier', 'import'],
	root: true,
	rules: {
		'prettier/prettier': 'error',
		'import/extensions': ['error', 'ignorePackages'],
	},
};
