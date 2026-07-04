import { NativeModule, requireNativeModule } from 'expo';

declare class SettingsBridgeModule extends NativeModule<Record<never, never>> {
  /** Persist the non-secret settings JSON (serialized @openflow/shared Settings). */
  syncSettings(json: string): void;
  /** Persist a secret keyed by its `apiKeyRef` (e.g. "stt.apiKey"). */
  syncSecret(ref: string, value: string): void;
}

export default requireNativeModule<SettingsBridgeModule>('SettingsBridge');
