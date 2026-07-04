import { requireOptionalNativeModule } from 'expo';

import type { TranslatorNativeModule } from './Translator.types';

/**
 * The raw native module ('Translator'), or `null` where it is not linked —
 * Jest, Expo Go, web, or any build that has not run prebuild. Using
 * `requireOptionalNativeModule` (rather than `requireNativeModule`) is what lets
 * the whole app keep running in those environments; the defensive loader in
 * `index.ts` turns `null` into a graceful "unavailable" surface.
 */
const TranslatorModule = requireOptionalNativeModule<TranslatorNativeModule>('Translator');

export default TranslatorModule;
