/** @type {import('stylelint').Config} */
const config = {
    plugins: ['stylelint-scss', 'stylelint-prettier'],
    extends: ['stylelint-config-html', 'stylelint-config-standard-scss'],
    rules: {
        'at-rule-no-unknown': [
            true,
            {
                ignoreAtRules: ['extends', 'tailwind', 'layer', 'apply', 'use'],
            },
        ],
        'block-no-empty': null,
        'no-descending-specificity': null,
        'property-no-unknown': null,
        'selector-pseudo-class-no-unknown': null,
        'scss/at-rule-no-unknown': [
            true,
            {
                ignoreAtRules: ['tailwind', 'use'],
            },
        ],
        'scss/dollar-variable-pattern': null,
    },
};

module.exports = config;
