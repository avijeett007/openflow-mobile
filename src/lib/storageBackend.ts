/**
 * A tiny async key/value contract so the settings + history stores can be
 * unit-tested with an in-memory backend and run in the app on AsyncStorage —
 * without pulling React Native into the Jest logic tests.
 */
export interface StorageBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** In-memory backend for tests. */
export function createMemoryBackend(seed: Record<string, string> = {}): StorageBackend {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    async getItem(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}

/**
 * The default backend: `@react-native-async-storage/async-storage`, resolved
 * defensively so importing this module never crashes under node/Jest.
 */
export function getDefaultBackend(): StorageBackend {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    return {
      getItem: (k) => AsyncStorage.getItem(k),
      setItem: (k, v) => AsyncStorage.setItem(k, v),
      removeItem: (k) => AsyncStorage.removeItem(k),
    };
  } catch {
    return createMemoryBackend();
  }
}
