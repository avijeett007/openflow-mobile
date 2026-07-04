/**
 * Jest config for the Expo app (chunk C2). Uses the `jest-expo` preset so React
 * Native + Expo modules transform correctly for component smoke tests. Logic
 * tests are RN-free (dependency-injected) but share this runner.
 *
 * `shared/` has its own Jest project; the root `test` script runs both.
 */
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@openflow/shared|zod))',
  ],
};
