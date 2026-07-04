import { defaultSettings } from '@openflow/shared';
import { loadSettings, saveSettings, SETTINGS_STORAGE_KEY } from './settingsStore';
import { createMemoryBackend } from './storageBackend';

describe('settingsStore round-trip', () => {
  it('returns defaults when nothing is persisted', async () => {
    const backend = createMemoryBackend();
    expect(await loadSettings(backend)).toEqual(defaultSettings());
  });

  it('persists and reloads mutated settings', async () => {
    const backend = createMemoryBackend();
    const next = defaultSettings();
    next.stt.provider = 'deepgram';
    next.stt.model = 'nova-2';
    next.cleanup.enabled = false;
    next.privacyMode = 'keywordsOnly';

    const saved = await saveSettings(next, backend);
    expect(saved.stt.provider).toBe('deepgram');

    const loaded = await loadSettings(backend);
    expect(loaded.stt.provider).toBe('deepgram');
    expect(loaded.stt.model).toBe('nova-2');
    expect(loaded.cleanup.enabled).toBe(false);
    expect(loaded.privacyMode).toBe('keywordsOnly');
  });

  it('never persists secrets (drops leaked apiKey on load)', async () => {
    const backend = createMemoryBackend();
    const polluted = { ...defaultSettings(), stt: { ...defaultSettings().stt, apiKey: 'sk-leak' } };
    await backend.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(polluted));

    const loaded = await loadSettings(backend);
    expect((loaded.stt as Record<string, unknown>).apiKey).toBeUndefined();
  });

  it('falls back to defaults on corrupt JSON', async () => {
    const backend = createMemoryBackend({ [SETTINGS_STORAGE_KEY]: 'not json{' });
    expect(await loadSettings(backend)).toEqual(defaultSettings());
  });
});
