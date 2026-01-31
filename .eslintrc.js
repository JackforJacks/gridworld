module.exports = {
    root: true,
    env: {
        node: true,
        browser: true,
        es2022: true
    },
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: ['./tsconfig.json', './tsconfig.server.json', './tsconfig.client.json']
    },
    plugins: ['@typescript-eslint'],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended'
    ],
    rules: {
        // === RECOMMENDED FIXES ===

        // Require radix parameter in parseInt (prevents "0x" prefix bugs)
        'radix': 'error',

        // Require strict equality (=== and !==)
        'eqeqeq': ['error', 'always', { null: 'ignore' }],

        // No empty catch blocks (prevents silent failures)
        'no-empty': ['error', { allowEmptyCatch: false }],

        // === ADDITIONAL QUALITY RULES ===

        // Disallow unused variables (with exceptions for intentional ignores)
        '@typescript-eslint/no-unused-vars': ['error', {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_'
        }],

        // Warn on console statements (use proper logger instead)
        'no-console': ['warn', { allow: ['warn', 'error'] }],

        // Disallow var, use let/const
        'no-var': 'error',

        // Prefer const when variable is never reassigned
        'prefer-const': 'error',

        // Require explicit return types on functions (helps catch bugs)
        '@typescript-eslint/explicit-function-return-type': 'off', // Enable later for stricter typing

        // Warn on 'any' type usage
        '@typescript-eslint/no-explicit-any': 'warn',

        // Disallow require() in favor of import
        '@typescript-eslint/no-require-imports': 'warn'
    },
    overrides: [
        // Relax rules for test files
        {
            files: ['**/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
            rules: {
                '@typescript-eslint/no-explicit-any': 'off',
                'no-console': 'off'
            }
        },
        // Relax rules for scripts
        {
            files: ['scripts/**/*.ts'],
            rules: {
                'no-console': 'off'
            }
        },
        // Legacy JS files
        {
            files: ['**/*.js'],
            rules: {
                '@typescript-eslint/no-require-imports': 'off'
            }
        }
    ],
    ignorePatterns: [
        'node_modules/',
        'dist/',
        'include/',
        '*.min.js',
        'coverage/'
    ]
};
