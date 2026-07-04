import { registerWebModule, NativeModule } from 'expo';

// Web is not a target for OpenFlow Mobile — these are inert no-ops so the JS
// surface stays uniform (the real implementations are Android + iOS native).
class SettingsBridgeModule extends NativeModule<Record<never, never>> {
  syncSettings(json: string): void {
    void json;
  }

  syncSecret(ref: string, value: string): void {
    void ref;
    void value;
  }
}

export default registerWebModule(SettingsBridgeModule, 'SettingsBridgeModule');
