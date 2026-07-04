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

// expo-speech-recognition — native on-device recognizer. Under Jest there is no
// native module, so `isRecognitionAvailable`/`supportsOnDeviceRecognition` return
// false (local mode reports "unavailable" — never silently hits the cloud).
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: jest.fn(() => false),
    supportsOnDeviceRecognition: jest.fn(() => false),
    getPermissionsAsync: jest.fn(async () => ({ granted: false })),
    requestPermissionsAsync: jest.fn(async () => ({ granted: false })),
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
    getSupportedLocales: jest.fn(async () => ({ locales: [], installedLocales: [] })),
    androidTriggerOfflineModelDownload: jest.fn(async () => ({
      status: 'download_success',
      message: '',
    })),
  },
  addSpeechRecognitionListener: jest.fn(() => ({ remove: jest.fn() })),
}));

// expo-speech — TTS stub. No native under Jest; the wrapper degrades to "no
// voice installed" (`canSpeak` false) and `speak` resolves immediately.
jest.mock('expo-speech', () => ({
  getAvailableVoicesAsync: jest.fn(async () => []),
  speak: jest.fn(),
  stop: jest.fn(async () => undefined),
  maxSpeechInputLength: 4000,
}));
