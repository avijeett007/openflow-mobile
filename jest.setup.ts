/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Jest setup for the app. Mocks native modules that component smoke tests touch
 * but that have no JS implementation under the test runner.
 */

// AsyncStorage ships an official Jest mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// expo-secure-store — in-memory stub.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      store.delete(k);
    }),
  };
});

// expo-audio — recorder stub (component tests never actually record).
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => ({
    prepareToRecordAsync: jest.fn(async () => undefined),
    record: jest.fn(),
    stop: jest.fn(async () => undefined),
    uri: null,
  }),
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  setAudioModeAsync: jest.fn(async () => undefined),
  RecordingPresets: { HIGH_QUALITY: {} },
}));

// expo-file-system — reading stub.
jest.mock('expo-file-system', () => ({
  readAsStringAsync: jest.fn(async () => ''),
  EncodingType: { Base64: 'base64' },
}));
