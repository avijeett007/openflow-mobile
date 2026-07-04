// Flat ESLint config (ESLint 9) matching Expo defaults.
const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'dist/**',
      'ios/**',
      'android/**',
      'shared/**/*.test.ts',
      'shared/src/testHelpers.ts',
    ],
  },
];
