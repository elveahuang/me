import parser from '@typescript-eslint/parser';
import reactPlugin from 'eslint-plugin-react';
import globals from 'globals';
import eslintTypescript from 'typescript-eslint';

/** @type {import('eslint').Config} */
const config = [
    ...eslintTypescript.configs.recommended,
    reactPlugin.configs.flat.recommended,
    {
        ignores: ['**/node_modules/', '**/vendor/', '**/dist/'],
    },
    {
        languageOptions: {
            parser: parser,
            sourceType: 'module',
            ecmaVersion: 'latest',
            globals: {
                ...globals.browser,
                ...globals.es2025,
                ...globals.node,
            },
        },
        settings: {
            react: {
                version: 'detect',
            },
        },
    },
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            '@typescript-eslint/no-var-requires': 'off',
            '@typescript-eslint/no-unsafe-function-type': 'off',
            '@typescript-eslint/no-require-imports': 'off',
            '@typescript-eslint/no-empty-object-type': 'off',
            '@typescript-eslint/ban-types': 'off',
            'react/react-in-jsx-scope': 'off',
            'react/jsx-uses-react': 'off',
        },
    },
];

export default config;
