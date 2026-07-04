import { ConfigError } from '../errors';
import {
  SETTINGS_VERSION,
  SettingsSchema,
  defaultPrompt,
  type Settings,
} from './schema';

export * from './schema';

/** Build a fresh settings object populated entirely from schema defaults. */
export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}

/**
 * Parse persisted settings, throwing {@link ConfigError} on invalid input.
 * Unknown keys (including any accidentally-persisted `apiKey` fields) are
 * stripped by zod, upholding the "no secrets in settings" invariant.
 */
export function parseSettings(input: unknown): Settings {
  const result = SettingsSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigError(`Invalid settings: ${result.error.message}`);
  }
  return result.data;
}

/** Non-throwing variant of {@link parseSettings}. */
export function safeParseSettings(input: unknown): { ok: true; settings: Settings } | { ok: false; error: string } {
  const result = SettingsSchema.safeParse(input);
  return result.success
    ? { ok: true, settings: result.data }
    : { ok: false, error: result.error.message };
}

/**
 * Migrate arbitrary persisted data to the current settings version, filling in
 * any missing fields with defaults. Older/unversioned payloads are coerced to
 * the current version. Any legacy secret fields are dropped in the process.
 */
export function migrateSettings(input: unknown): Settings {
  const raw: Record<string, unknown> =
    input && typeof input === 'object' ? { ...(input as Record<string, unknown>) } : {};

  // No historical versions exist yet in v1 — future migrations branch here on
  // `raw.version`. Coerce anything to the current version and re-parse.
  raw.version = SETTINGS_VERSION;

  return parseSettings(raw);
}

/**
 * Produce the object safe to persist. Identical to the parsed settings (the
 * schema already excludes secrets) — provided as an explicit, self-documenting
 * boundary for callers writing to disk.
 */
export function serializeSettings(settings: Settings): Settings {
  return SettingsSchema.parse(settings);
}

/** The default prompt list (currently just the built-in cleanup prompt). */
export function defaultPrompts() {
  return [defaultPrompt()];
}
