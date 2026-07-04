import {
  SETTINGS_VERSION,
  TranslatorSettingsSchema,
  defaultSettings,
  migrateSettings,
  parseSettings,
  safeParseSettings,
  serializeSettings,
} from './index';

const DEFAULTS = {
  langs: { a: 'en', b: 'es' },
  speakEnabled: true,
  autoDetect: false,
  wifiOnlyDownloads: true,
};

describe('TranslatorSettingsSchema (additive, version stays 1)', () => {
  it('SETTINGS_VERSION is still 1', () => {
    expect(SETTINGS_VERSION).toBe(1);
  });

  it('defaultSettings() carries the translator defaults', () => {
    expect(defaultSettings().translator).toEqual(DEFAULTS);
  });

  it('standalone parse of {} fills every default', () => {
    expect(TranslatorSettingsSchema.parse({})).toEqual(DEFAULTS);
  });

  it('a pre-translator (v0.2) payload parses and gains the defaults — additive migration', () => {
    const legacy = JSON.parse(JSON.stringify(defaultSettings())) as Record<string, unknown>;
    delete legacy.translator;
    expect(parseSettings(legacy).translator).toEqual(DEFAULTS);
    expect(migrateSettings(legacy).translator).toEqual(DEFAULTS);
  });

  it('partial translator payloads fill only the missing fields', () => {
    const s = parseSettings({
      ...defaultSettings(),
      translator: { langs: { a: 'de' }, autoDetect: true },
    });
    expect(s.translator).toEqual({
      langs: { a: 'de', b: 'es' },
      speakEnabled: true,
      autoDetect: true,
      wifiOnlyDownloads: true,
    });
  });

  it('custom values roundtrip through serialize → parse', () => {
    const custom = {
      ...defaultSettings(),
      translator: {
        langs: { a: 'zh-Hans', b: 'en-US' },
        speakEnabled: false,
        autoDetect: true,
        wifiOnlyDownloads: false,
      },
    };
    const roundtripped = parseSettings(JSON.parse(JSON.stringify(serializeSettings(custom))));
    expect(roundtripped.translator).toEqual(custom.translator);
  });

  it('rejects empty language codes', () => {
    const bad = { ...defaultSettings(), translator: { ...DEFAULTS, langs: { a: '', b: 'es' } } };
    const result = safeParseSettings(bad);
    expect(result.ok).toBe(false);
  });

  it('rejects non-boolean toggles', () => {
    const bad = { ...defaultSettings(), translator: { ...DEFAULTS, speakEnabled: 'yes' } };
    expect(safeParseSettings(bad).ok).toBe(false);
  });

  it('the Kotlin IME mirror surface (stt.mode) is untouched by the addition', () => {
    const s = migrateSettings({ stt: { mode: 'local' } });
    expect(s.stt.mode).toBe('local');
    expect(s.version).toBe(1);
    expect(s.translator).toEqual(DEFAULTS);
  });
});
