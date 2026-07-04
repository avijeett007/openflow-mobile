import type { TranslatorNativeModule } from './Translator.types';

/**
 * Web is not a target for OpenFlow Mobile. There is no on-device translation in
 * the browser, so the native module resolves to `null` here and the defensive
 * loader (index.ts) reports translation as unavailable — same as Jest/Expo Go.
 */
const TranslatorModule: TranslatorNativeModule | null = null;

export default TranslatorModule;
