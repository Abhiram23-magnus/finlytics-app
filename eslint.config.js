'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'public/vendor/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'eqeqeq': ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
  {
    files: ['public/currencies.js'],
    languageOptions: { sourceType: 'script', globals: { module: 'writable' } },
  },
  {
    files: ['public/common.js'],
    rules: { 'no-unused-vars': 'off', 'no-redeclare': 'off' },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser, Chart: 'readonly',
        // shared helpers defined in public/common.js
        Api: 'readonly', h: 'readonly', icon: 'readonly', safeColor: 'readonly', tint: 'readonly',
        FALLBACK_COLOR: 'readonly', CURRENCY_CODES: 'readonly', CURRENCIES: 'readonly', currencyInfo: 'readonly', formatMoney: 'readonly',
        formatDate: 'readonly', localDateString: 'readonly', localMonthString: 'readonly',
        showToast: 'readonly', withBusy: 'readonly', debounce: 'readonly',
      },
    },
    rules: {
      // Flag string-HTML sinks so user data never reaches them again.
      'no-restricted-properties': ['error',
        { property: 'innerHTML', message: 'Use textContent / DOM APIs (see public/js/dom.js).' },
        { property: 'outerHTML', message: 'Use DOM APIs.' }],
      'no-restricted-syntax': ['error',
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'Use DOM APIs.' },
        { selector: "CallExpression[callee.object.name='document'][callee.property.name='write']", message: 'Use DOM APIs.' }],
    },
  },
  {
    // Functions passed to page.evaluate() run in the browser
    files: ['test/e2e/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
];
