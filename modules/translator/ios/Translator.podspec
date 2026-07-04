Pod::Spec.new do |s|
  s.name           = 'Translator'
  s.version        = '1.0.0'
  s.summary        = 'On-device translation, language identification and STT-locale enumeration for OpenFlow Mobile (iOS).'
  s.description    = 'Wraps the Apple Translation framework (iOS 18+), NLLanguageRecognizer and SFSpeechRecognizer behind the frozen modules/translator JS surface.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  # iOS 16.4 deployment floor (matches settings-bridge / the app). The Translation
  # framework APIs are runtime-gated with `#available(iOS 18.0, *)` inside the
  # module, so this pod builds and links on iOS 16/17 — `isTranslationAvailable()`
  # simply reports `available: false` there. iOS 26 fast-path is also runtime-gated.
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # System frameworks used by the module (all present since iOS 16 SDK; the
  # Translation symbols are weak-linked / availability-gated at runtime).
  s.frameworks = 'Translation', 'NaturalLanguage', 'Speech'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
