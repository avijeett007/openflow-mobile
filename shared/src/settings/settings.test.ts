import {
  defaultSettings,
  defaultPrompt,
  parseSettings,
  safeParseSettings,
  migrateSettings,
  serializeSettings,
  SETTINGS_VERSION,
} from './index';
import { ConfigError } from '../errors';

describe('settings defaults', () => {
  it('produces a fully-populated default object', () => {
    const s = defaultSettings();
    expect(s.version).toBe(SETTINGS_VERSION);
    expect(s.stt).toEqual({
      mode: 'remote',
      provider: 'groq',
      model: 'whisper-large-v3-turbo',
      apiKeyRef: 'stt.apiKey',
    });
    expect(s.cleanup).toEqual({
      enabled: true,
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      apiKeyRef: 'cleanup.apiKey',
      promptId: 'improve-transcription',
    });
    expect(s.prompts).toEqual([defaultPrompt()]);
    expect(s.privacyMode).toBe('full');
  });

  it('never persists API keys — only refs', () => {
    const serialized = JSON.stringify(serializeSettings(defaultSettings()));
    expect(serialized).not.toMatch(/apiKey"\s*:/);
    expect(serialized).toContain('apiKeyRef');
  });
});

describe('parse / roundtrip', () => {
  it('roundtrips defaults through serialize', () => {
    const s = defaultSettings();
    expect(serializeSettings(s)).toEqual(s);
    expect(parseSettings(s)).toEqual(s);
  });

  it('rejects invalid providers', () => {
    expect(() => parseSettings({ stt: { provider: 'nope' } })).toThrow(ConfigError);
    const res = safeParseSettings({ stt: { provider: 'nope' } });
    expect(res.ok).toBe(false);
  });
});

describe('local STT mode', () => {
  it('parses mode "local" with none of the remote fields present, filling defaults', () => {
    const s = parseSettings({ stt: { mode: 'local' } });
    expect(s.stt.mode).toBe('local');
    // Irrelevant-in-local fields are still populated by their defaults so the
    // persisted shape stays stable for the Kotlin IME mirror.
    expect(s.stt.provider).toBe('groq');
    expect(s.stt.model).toBe('whisper-large-v3-turbo');
    expect(s.stt.apiKeyRef).toBe('stt.apiKey');
    expect(s.stt.baseUrl).toBeUndefined();
  });

  it('accepts "local" as a valid mode alongside remote / selfHosted', () => {
    expect(parseSettings({ stt: { mode: 'remote' } }).stt.mode).toBe('remote');
    expect(parseSettings({ stt: { mode: 'selfHosted' } }).stt.mode).toBe('selfHosted');
    expect(parseSettings({ stt: { mode: 'local' } }).stt.mode).toBe('local');
  });

  it('rejects an unknown mode', () => {
    expect(() => parseSettings({ stt: { mode: 'ondevice' } })).toThrow(ConfigError);
  });

  it('migrates a bare local payload to full defaults without a version bump', () => {
    const migrated = migrateSettings({ stt: { mode: 'local' } });
    expect(migrated.version).toBe(SETTINGS_VERSION);
    expect(migrated.stt.mode).toBe('local');
    expect(migrated.cleanup.enabled).toBe(true); // cleanup still available in local mode
  });

  it('roundtrips a local-mode settings object through serialize', () => {
    const local = { ...defaultSettings(), stt: { ...defaultSettings().stt, mode: 'local' as const } };
    expect(serializeSettings(local)).toEqual(local);
    expect(parseSettings(local)).toEqual(local);
  });
});

describe('migrate', () => {
  it('fills defaults for an empty object', () => {
    expect(migrateSettings({})).toEqual(defaultSettings());
  });

  it('coerces version and preserves valid partial overrides', () => {
    const migrated = migrateSettings({
      stt: { provider: 'openai', model: 'whisper-1' },
      privacyMode: 'keywordsOnly',
    });
    expect(migrated.version).toBe(SETTINGS_VERSION);
    expect(migrated.stt.provider).toBe('openai');
    expect(migrated.stt.model).toBe('whisper-1');
    expect(migrated.privacyMode).toBe('keywordsOnly');
  });

  it('strips any leaked secret fields during migration', () => {
    const migrated = migrateSettings({
      stt: { provider: 'groq', apiKey: 'sk-should-be-dropped' },
      cleanup: { provider: 'groq', apiKey: 'sk-also-dropped' },
    });
    const serialized = JSON.stringify(migrated);
    expect(serialized).not.toContain('sk-should-be-dropped');
    expect(serialized).not.toContain('sk-also-dropped');
    expect(serialized).not.toMatch(/"apiKey"\s*:/);
  });

  it('handles non-object input by returning defaults', () => {
    expect(migrateSettings(null)).toEqual(defaultSettings());
    expect(migrateSettings('garbage')).toEqual(defaultSettings());
  });
});
