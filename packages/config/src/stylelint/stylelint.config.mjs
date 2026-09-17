/** @type {import('stylelint').Config} */
const config = {
    extends: ['stylelint-config-html', 'stylelint-config-recess-order'],
    rules: {
        'at-rule-no-unknown': [
            true,
            {
                // Tailwind v4 的专属 at-rule（@theme / @custom-variant / @source / @variant 等）不在标准语法内，
                // 不忽略会让 `pnpm stylelint` 对整个项目报假错误。
                ignoreAtRules: ['extends', 'tailwind', 'layer', 'apply', 'use', 'theme', 'custom-variant', 'source', 'variant', 'utility', 'reference'],
            },
        ],
        'block-no-empty': null,
        'no-descending-specificity': null,
        'property-no-unknown': null,
        'selector-pseudo-class-no-unknown': null,
    },
};

export default config;
