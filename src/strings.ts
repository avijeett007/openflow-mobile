/**
 * Centralized UI copy. OpenFlow Mobile ships a single locale in v1; keeping all
 * user-facing strings here makes a future i18n pass (extract to catalogs) cheap.
 * No wake-word / voice-feedback copy — mobile is tap-to-talk only.
 */

export const strings = {
  brand: {
    open: 'Open',
    flow: 'Flow',
    tagline: 'Voice dictation, your keys, your endpoints.',
  },

  onboarding: {
    welcome: {
      title: 'Welcome to OpenFlow',
      body: 'A private, open-source voice keyboard. Speak anywhere; OpenFlow transcribes and cleans up your words using the AI providers and API keys you choose. Nothing is sent anywhere you did not configure.',
      cta: 'Get started',
    },
    enableKeyboard: {
      title: 'Enable the OpenFlow keyboard',
      iosSteps: [
        'Open the Settings app.',
        'Go to General → Keyboard → Keyboards.',
        'Tap "Add New Keyboard…" and choose OpenFlow.',
        'Tap OpenFlow in the list, then turn on "Allow Full Access".',
      ],
      // Honest privacy copy — required for App Store review and user trust.
      iosPrivacy:
        'Why Full Access? The keyboard cannot record audio itself (iOS blocks that). Tapping the mic hands off to the OpenFlow app, which records and transcribes, then hands the text back. Full Access lets the keyboard read that finished text from the shared app group. OpenFlow never logs your keystrokes and only contacts the endpoints you configure.',
      androidSteps: [
        'Open the Settings app.',
        'Go to System → Languages & input → On-screen keyboard.',
        'Tap "Manage keyboards".',
        'Turn on OpenFlow, then confirm the permission prompt.',
      ],
      androidPrivacy:
        'On Android the OpenFlow keyboard records and transcribes in place using the microphone permission you grant. Audio is sent only to the STT/cleanup endpoints you configure and is not stored after transcription.',
      cta: 'Next',
      skip: 'Skip for now',
    },
    backend: {
      title: 'Choose your providers',
      body: 'Pick where your speech is transcribed and (optionally) cleaned up, then paste your API keys. Keys are stored in the device secure store — never in plain settings.',
      cta: 'Finish setup',
      testStt: 'Test speech-to-text',
      testCleanup: 'Test cleanup',
    },
  },

  home: {
    title: 'Dictate',
    idleHint: 'Tap the mic and start speaking',
    recording: 'Listening… tap to stop',
    transcribing: 'Transcribing…',
    cleaning: 'Cleaning up…',
    ready: 'Ready',
    copy: 'Copy',
    copied: 'Copied!',
    clear: 'Clear',
    raw: 'Raw transcript',
    cleaned: 'Cleaned',
    retry: 'Retry',
    permissionTitle: 'Microphone needed',
    permissionBody:
      'OpenFlow needs the microphone to record your dictation. Recording happens only while you hold a session; audio is sent solely to your configured provider.',
    cleanupFellBack: 'Cleanup failed — showing the raw transcript. Saved to history as raw-only.',
  },

  hop: {
    listening: 'Listening… tap to stop',
    processing: 'Transcribing your dictation…',
    doneTitle: 'Done',
    doneBody: 'Tap the ‹ Back breadcrumb at the top-left to insert your text.',
    errorTitle: 'Something went wrong',
    retry: 'Try again',
  },

  settings: {
    title: 'Settings',
    sttSection: 'Speech-to-text',
    cleanupSection: 'Cleanup',
    privacySection: 'Privacy',
    mode: 'Mode',
    // STT mode options. "Local" is intentionally listed first.
    modeLocal: 'Local (on-device) — free, private, no API key',
    modeRemote: 'Remote',
    modeSelfHosted: 'Self-hosted',
    // Honest, per-platform caveats for on-device recognition.
    localCaveatIos:
      "On-device dictation uses Apple's Speech framework — audio never leaves your iPhone and no API key is needed. Accuracy depends on your device and iOS version, and it needs the Speech Recognition permission. If your language isn't supported on-device, use a Remote provider instead.",
    localCaveatAndroid:
      "On-device dictation uses Android's built-in recognizer — audio stays on your phone and no API key is needed. Availability and accuracy depend on your device, and it may require installing an offline language pack (Settings → speech/voice input). If on-device speech isn't installed, use a Remote provider instead.",
    // Privacy implication when cleanup is left on in local mode.
    localCleanupPrivacy:
      'Note: transcription is on-device, but Cleanup still sends the transcript text to the cleanup provider you configured. Turn Cleanup off to keep everything on your device.',
    testLocal: 'Test on-device recognition',
    testLocalListening: 'Listening for 2s — speak now…',
    provider: 'Provider',
    baseUrl: 'Base URL',
    model: 'Model',
    apiKey: 'API key',
    apiKeyPlaceholder: 'Paste your API key',
    apiKeySaved: 'Key saved to secure store',
    cleanupEnabled: 'Enable cleanup',
    prompt: 'Cleanup prompt',
    customPrompt: 'Custom prompt text',
    addPrompt: 'Add custom prompt',
    privacyMode: 'History detail',
    save: 'Save',
    saved: 'Saved',
    test: 'Test connection',
    testing: 'Testing…',
    testPass: 'Connection OK',
    testFail: 'Failed',
  },

  privacyModes: {
    full: 'Full — keep raw + cleaned text',
    keywordsOnly: 'Metadata only — drop text, keep counts',
    off: 'Minimal — counts and timing only',
  },

  history: {
    title: 'History',
    empty: 'No dictations yet. Your history stays on this device.',
    analyticsWords: 'Words',
    analyticsCount: 'Dictations',
    analyticsSaved: 'Est. time saved',
    redacted: '(text hidden by privacy setting)',
    rawOnly: 'raw only — cleanup failed',
    clearAll: 'Clear history',
  },

  about: {
    title: 'About',
    tagline: 'OpenFlow — the open-source, bring-your-own-key alternative to Wispr Flow.',
    license: 'MIT licensed.',
    website: 'openflow.computer',
    github: 'github.com/avijeett007/openflow-mobile',
    coffee: 'buymeacoffee.com/kno2gether',
    email: 'hello@openflow.computer',
    credit: 'Built with care by the knotie.ai team.',
    version: 'Version',
  },

  translate: {
    title: 'Live Translation',
    // Empty-pane prompts, labelled by language name.
    tapToSpeakFmt: (lang: string): string => `Tap the mic and speak ${lang}`,
    listeningFmt: (lang: string): string => `Listening in ${lang}…`,
    translating: 'Translating…',
    speaking: 'Speaking…',
    // Accessibility: mic button labels.
    speakInFmt: (lang: string): string => `Speak in ${lang}`,
    stopListening: 'Stop listening',
    // Center bar.
    swap: 'Swap languages',
    speakOn: 'Speak translations aloud',
    speakOff: 'Speak translations (no voice installed for this language)',
    soloMode: 'Solo mode (don’t rotate the top pane)',
    history: 'History',
    // Offline / pack status chip.
    offlineReady: 'On-device — works offline',
    packMissingFmt: (lang: string): string =>
      `Translation pack for ${lang} not installed — download it to translate offline.`,
    translationUnavailable: 'On-device translation is unavailable on this device.',
    // Announced to VoiceOver when a new translation appears.
    announceFmt: (lang: string, text: string): string => `Translation in ${lang}: ${text}`,
    // Honest per-turn error copy (fallbacks when the platform gives no message).
    sttUnavailable:
      'On-device speech recognition is unavailable for this language on this device.',
    permissionDenied: 'Speech-recognition permission was not granted.',
    sttFailed: 'Couldn’t hear that — please try again.',
    translateFailed:
      'Couldn’t translate that. The language pack may be missing — download it below and try again.',
    // Language picker.
    pickerTitleFmt: (side: string): string => `Choose ${side} language`,
    sideA: 'your',
    sideB: 'their',
    usableSection: 'Ready to use',
    downloadableSection: 'Available to download',
    download: 'Download',
    downloading: 'Downloading…',
    wifiOnly: 'Download over Wi-Fi only',
    packSizeNote: '~30 MB',
    // STT-pack-missing row copy (per platform).
    sttMissingAndroid:
      'Speech recognition for this language isn’t installed. Tap to download the offline model (Android 13+).',
    sttMissingAndroidCta: 'Install speech model',
    sttMissingIos:
      'Speech recognition for this language isn’t installed. Add it in Settings ▸ General ▸ Keyboard ▸ Dictation Languages, then reopen this screen.',
    sttUnknown: 'Speech-model availability couldn’t be checked on this device.',
    // Badges legend.
    badgeInstalled: 'Installed',
    badgeDownloadable: 'Downloadable',
    badgeDownloading: 'Downloading',
    badgeUnsupported: 'Not supported',
    // Required attribution (Android / ML Kit terms).
    poweredByGoogle: 'Translations powered by Google',
    copy: 'Copy',
    copied: 'Copied!',
    emptyHistory: 'No translations yet. Your conversation stays on this device.',
    // Platform explainer when translation isn't available at all.
    iosFloorExplainer:
      'Live Translation needs iOS 18 or newer with Apple’s on-device Translation. Everything else in OpenFlow still works.',
  },

  common: {
    cancel: 'Cancel',
    back: 'Back',
    close: 'Close',
  },
} as const;
