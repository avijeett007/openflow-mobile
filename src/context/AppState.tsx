import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type Settings, defaultSettings } from '@openflow/shared';
import { loadSettings, saveSettings } from '../lib/settingsStore';
import {
  type AppHistoryRecord,
  addHistoryRecord,
  clearHistory,
  loadHistory,
} from '../lib/historyStore';
import { isOnboarded, setOnboarded } from '../lib/onboarding';

/**
 * App-wide state: persisted settings, on-device history, and the onboarding
 * flag. A single provider so screens and `useDictation` share one live copy and
 * every mutation is persisted (and, for settings, mirrored to the bridge).
 */

interface AppStateValue {
  ready: boolean;
  settings: Settings;
  /** Live ref-based getter so async flows read the latest settings. */
  getSettings: () => Settings;
  updateSettings: (next: Settings) => Promise<void>;
  history: AppHistoryRecord[];
  addRecord: (record: AppHistoryRecord) => Promise<void>;
  clearAllHistory: () => Promise<void>;
  onboarded: boolean;
  completeOnboarding: () => Promise<void>;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  const [history, setHistory] = useState<AppHistoryRecord[]>([]);
  const [onboarded, setOnboardedState] = useState(false);

  // Keep a ref so async orchestration always reads the freshest settings.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, h, o] = await Promise.all([loadSettings(), loadHistory(), isOnboarded()]);
      if (cancelled) return;
      setSettings(s);
      setHistory(h);
      setOnboardedState(o);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = useCallback(async (next: Settings) => {
    const saved = await saveSettings(next);
    setSettings(saved);
  }, []);

  const addRecord = useCallback(async (record: AppHistoryRecord) => {
    const next = await addHistoryRecord(record);
    setHistory(next);
  }, []);

  const clearAllHistory = useCallback(async () => {
    await clearHistory();
    setHistory([]);
  }, []);

  const completeOnboarding = useCallback(async () => {
    await setOnboarded(true);
    setOnboardedState(true);
  }, []);

  const getSettings = useCallback(() => settingsRef.current, []);

  const value = useMemo<AppStateValue>(
    () => ({
      ready,
      settings,
      getSettings,
      updateSettings,
      history,
      addRecord,
      clearAllHistory,
      onboarded,
      completeOnboarding,
    }),
    [
      ready,
      settings,
      getSettings,
      updateSettings,
      history,
      addRecord,
      clearAllHistory,
      onboarded,
      completeOnboarding,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within an AppStateProvider');
  return ctx;
}
