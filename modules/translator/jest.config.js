/**
 * Local Jest project for the modules/translator JS layer. The root jest.config
 * only roots `<rootDir>/src`, so this module carries its own runner. The tests
 * are React-Native-free (dependency-injected fake native module), but we reuse
 * the `jest-expo` preset for parity with the app runner and so `import { ... }
 * from 'expo'` resolves.
 *
 * `rootDir` is the repo root so babel-preset-expo (babel.config.js) resolves the
 * same way it does for the app; `roots` scopes collection to this module only.
 *
 * Run from the repo root:  npx jest --config modules/translator/jest.config.js
 *
 * (T5 integration folds this into the root `npm test` alongside shared/.)
 */
module.exports = {
  preset: 'jest-expo',
  // `rootDir` is resolved relative to THIS config file → the repo root, so
  // babel-preset-expo (babel.config.js) resolves the same way it does for the app.
  rootDir: '../..',
  roots: ['<rootDir>/modules/translator'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@openflow/shared|zod))',
  ],
};
