import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { TranslatorModuleApi, TranslatorSettings } from '@openflow/shared';
import { TranslateScreenView } from './TranslateScreen';
import type { LocalStt } from '../lib/localStt';
import type { SpeechEngine } from '../lib/speech';
import { strings } from '../strings';

function fakeTranslator(over: Partial<TranslatorModuleApi> = {}): TranslatorModuleApi {
  return {
    translate: jest.fn(async () => ({ text: 'hola' })),
    getPairStatus: jest.fn(async () => 'installed'),
    downloadPack: jest.fn(async () => undefined),
    listSupportedLanguages: jest.fn(async () => ['en', 'es']),
    listDownloadedLanguages: jest.fn(async () => ['en']),
    deletePack: jest.fn(async () => true),
    identifyLanguage: jest.fn(async () => null),
    sttOnDeviceLocales: jest.fn(async () => ['en-US', 'es-ES']),
    isTranslationAvailable: jest.fn(async () => ({ available: true })),
    ...over,
  };
}

function fakeLocalStt(): LocalStt {
  return {
    isAvailable: jest.fn(async () => ({ available: true })),
    requestPermission: jest.fn(async () => true),
    start: jest.fn(async () => undefined),
    stop: jest.fn(async () => ({ transcript: '' })),
    cancel: jest.fn(async () => undefined),
  };
}

function fakeSpeech(): SpeechEngine {
  return {
    getVoices: jest.fn(async () => []),
    canSpeak: jest.fn(async () => true),
    speak: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    refreshVoices: jest.fn(),
  };
}

const settings: TranslatorSettings = {
  langs: { a: 'en', b: 'es' },
  speakEnabled: true,
  autoDetect: false,
  wifiOnlyDownloads: true,
};

function renderScreen(over: Partial<React.ComponentProps<typeof TranslateScreenView>> = {}) {
  const translator = over.translator ?? fakeTranslator();
  const persist = jest.fn();
  const utils = render(
    <TranslateScreenView
      translator={translator}
      localStt={fakeLocalStt()}
      speech={fakeSpeech()}
      settings={settings}
      persist={persist}
      reduceMotion
      screenReader={false}
      {...over}
    />,
  );
  return { ...utils, translator, persist };
}

describe('TranslateScreen', () => {
  const originalOS = Platform.OS;
  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('renders both language panes and mic buttons labelled by language', async () => {
    const { getAllByText, getByLabelText, translator } = renderScreen();
    await waitFor(() => expect(translator.listSupportedLanguages).toHaveBeenCalled());
    expect(getAllByText('English ▾').length).toBeGreaterThan(0);
    expect(getAllByText('Spanish ▾').length).toBeGreaterThan(0);
    expect(getByLabelText(strings.translate.speakInFmt('English'))).toBeTruthy();
    expect(getByLabelText(strings.translate.speakInFmt('Spanish'))).toBeTruthy();
  });

  it('shows the "powered by Google" attribution on Android only', async () => {
    Platform.OS = 'android';
    const { queryByText, translator } = renderScreen();
    await waitFor(() => expect(translator.listSupportedLanguages).toHaveBeenCalled());
    expect(queryByText(strings.translate.poweredByGoogle)).toBeTruthy();
  });

  it('omits the attribution on iOS', async () => {
    Platform.OS = 'ios';
    const { queryByText, translator } = renderScreen();
    await waitFor(() => expect(translator.listSupportedLanguages).toHaveBeenCalled());
    expect(queryByText(strings.translate.poweredByGoogle)).toBeNull();
  });

  it('opens the language picker with computeUsable rows + download affordance', async () => {
    Platform.OS = 'ios';
    const { getByText, findByText, findByLabelText } = renderScreen();
    // Open side A's picker.
    fireEvent.press(getByText('English ▾'));
    expect(await findByText('Choose your language')).toBeTruthy();
    // Spanish pack is downloadable (supported but not downloaded) → Download button.
    expect(await findByLabelText('Download Spanish')).toBeTruthy();
  });

  it('shows the translation-unavailable chip when the module reports unavailable', async () => {
    const translator = fakeTranslator({
      isTranslationAvailable: jest.fn(async () => ({ available: false, reason: 'iOS 18 required' })),
    });
    const { findByText } = renderScreen({ translator });
    expect(await findByText(/iOS 18 required/)).toBeTruthy();
  });

  it('solo-mode toggle is disabled (forced on) when a screen reader is active', async () => {
    const { getByLabelText, translator } = renderScreen({ screenReader: true });
    await waitFor(() => expect(translator.listSupportedLanguages).toHaveBeenCalled());
    const solo = getByLabelText(strings.translate.soloMode);
    expect(solo.props.accessibilityState.disabled).toBe(true);
  });

  it('solo-mode toggle flips when tapped', async () => {
    const { getByLabelText, translator } = renderScreen();
    await waitFor(() => expect(translator.listSupportedLanguages).toHaveBeenCalled());
    const solo = getByLabelText(strings.translate.soloMode);
    expect(solo.props.accessibilityState.selected).toBe(false);
    fireEvent.press(solo);
    expect(getByLabelText(strings.translate.soloMode).props.accessibilityState.selected).toBe(true);
  });

  it('picking a usable language persists the change', async () => {
    Platform.OS = 'ios';
    // Make both languages installed so both are pickable.
    const translator = fakeTranslator({
      listDownloadedLanguages: jest.fn(async () => ['en', 'es', 'fr']),
      listSupportedLanguages: jest.fn(async () => ['en', 'es', 'fr']),
      sttOnDeviceLocales: jest.fn(async () => ['en-US', 'es-ES', 'fr-FR']),
    });
    const { getByText, findByLabelText, persist } = renderScreen({ translator });
    fireEvent.press(getByText('Spanish ▾')); // side B picker
    const frRow = await findByLabelText(/French/);
    fireEvent.press(frRow);
    await waitFor(() => expect(persist).toHaveBeenCalled());
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ langs: { a: 'en', b: 'fr' } }));
  });
});
