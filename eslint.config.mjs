// Lints the dashboard (runs in the TV's web runtime), the native helpers (Node 20
// on the TV) and the tests. Compact one-line style is intentional; only rules that
// catch real defects are enabled.
import js from '@eslint/js';
import globals from 'globals';

const shared = {
  // Empty catch blocks and unused catch bindings are deliberate best-effort fallbacks
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-unused-vars': ['error', { caughtErrors: 'none', args: 'after-used' }],
  // Input sanitizers match control characters on purpose
  'no-control-regex': 'off',
};

export default [
  { ignores: ['node_modules/', 'dist/', 'coverage/', 'test-results/', 'playwright-report/', '.private/'] },
  js.configs.recommended,
  {
    files: ['app/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      // UMD modules also export to the Node tests through `module`
      globals: {
        ...globals.browser,
        module: 'readonly',
        OwnTVBridge: 'readonly',
        OwnTVI18n: 'readonly',
        OwnTVMapData: 'readonly',
        OwnTVOrder: 'readonly',
        OwnTVSolar: 'readonly',
        OwnTVWeather: 'readonly',
        OwnTVWeatherMap: 'readonly',
      },
    },
    rules: shared,
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: shared,
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: shared,
  },
  {
    files: ['e2e/**/*.cjs'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
];
