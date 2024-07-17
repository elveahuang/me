const { FlatCompat } = require('@eslint/eslintrc');
const eslint = require('@eslint/js');
const typescript = require('typescript-eslint');
const parser = require('@typescript-eslint/parser');
const globals = require('globals');

const compat = new FlatCompat({
    baseDirectory: __dirname,
});

/** @type {import("eslint").Config} */
const config = [
    eslint.configs.recommended,
    ...typescript.configs.recommended,
    ...compat.plugins('react', 'react-hooks', 'jsx-a11y', 'prettier'),
    ...compat.extends('plugin:react/recommended', 'plugin:react-hooks/recommended', 'plugin:jsx-a11y/recommended', 'plugin:prettier/recommended'),
    {
        ignores: ['**/node_modules/', '**/dist/'],
    },
    {
        languageOptions: {
            parser: parser,
            sourceType: 'module',
            ecmaVersion: 'latest',
            globals: {
                ...globals.browser,
                ...globals.es2021,
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
            '@typescript-eslint/ban-types': 'off',
            'react/react-in-jsx-scope': 'off',
            'react/jsx-uses-react': 'off',
            'react-hooks/rules-of-hooks': 'off',
            'react-hooks/exhaustive-deps': 'off',
            'jsx-a11y/click-events-have-key-events': 'off',
            'jsx-a11y/no-static-element-interactions': 'off',
        },
    },
];

module.exports = config;
