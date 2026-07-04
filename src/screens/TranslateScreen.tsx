import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import {
  type Side,
  type TranslatorModuleApi,
  type TranslatorSettings,
  type UsableLang,
  displayLanguageName,
  getPackState,
  otherSide,
} from '@openflow/shared';
import { colors, font, radius, spacing } from '../theme';
import { strings } from '../strings';
import { type LocalStt, localStt as defaultLocalStt, triggerAndroidOfflineModelDownload } from '../lib/localStt';
import { type SpeechEngine, speech as defaultSpeech } from '../lib/speech';
import { translator as defaultTranslator } from '../lib/translator';
import { useTranslatorCatalog } from '../hooks/useTranslatorCatalog';
import { useTranslatorTurn } from '../hooks/useTranslatorTurn';
import { useAppState } from '../context/AppState';

/**
 * TranslateScreen — the face-to-face "Live Translation" surface.
 *
 * `TranslateScreenView` is the fully dependency-injected, context-free component
 * (unit-testable). The default export wires it to the real singletons + settings
 * store.
 */

// ---- View (injectable, context-free) --------------------------------------

export interface TranslateScreenViewProps {
  translator: TranslatorModuleApi;
  localStt: LocalStt;
  speech: SpeechEngine;
  settings: TranslatorSettings;
  persist: (patch: Partial<TranslatorSettings>) => void;
  /** Test seams — when omitted, read live from AccessibilityInfo. */
  reduceMotion?: boolean;
  screenReader?: boolean;
}

export function TranslateScreenView({
  translator,
  localStt,
  speech,
  settings,
  persist,
  reduceMotion: reduceMotionProp,
  screenReader: screenReaderProp,
}: TranslateScreenViewProps): React.ReactElement {
  const isAndroid = Platform.OS === 'android';

  // --- Accessibility (Reduce Motion + VoiceOver → auto solo) ---
  const [reduceMotionState, setReduceMotionState] = useState(false);
  const [screenReaderState, setScreenReaderState] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled?.().then((v) => alive && setReduceMotionState(!!v));
    void AccessibilityInfo.isScreenReaderEnabled?.().then((v) => alive && setScreenReaderState(!!v));
    const rm = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) =>
      setReduceMotionState(!!v),
    );
    const sr = AccessibilityInfo.addEventListener?.('screenReaderChanged', (v) =>
      setScreenReaderState(!!v),
    );
    return () => {
      alive = false;
      rm?.remove?.();
      sr?.remove?.();
    };
  }, []);
  const reduceMotion = reduceMotionProp ?? reduceMotionState;
  const screenReader = screenReaderProp ?? screenReaderState;

  const [soloUser, setSoloUser] = useState(false);
  const solo = soloUser || screenReader; // VoiceOver forces solo (no upside-down pane)

  const catalog = useTranslatorCatalog({ translator });

  const turn = useTranslatorTurn({
    localStt,
    translator,
    speech,
    sttLocales: catalog.sttLocales,
    initialLangs: settings.langs,
    initialSpeakEnabled: settings.speakEnabled,
    autoDetect: settings.autoDetect,
    onLangsChange: (langs) => persist({ langs }),
    onSpeakEnabledChange: (enabled) => persist({ speakEnabled: enabled }),
  });
  const { state } = turn;
  const { langs } = state;

  // Track which side spoke, so we can show "Translating…" on the target pane.
  const lastActiveRef = useRef<Side>('a');
  useEffect(() => {
    if (state.status === 'listening' && state.activeSide) lastActiveRef.current = state.activeSide;
  }, [state.status, state.activeSide]);

  // Does an installed voice exist for each side's language? Gates the toggle.
  const [voiceFor, setVoiceFor] = useState<{ a: boolean; b: boolean }>({ a: false, b: false });
  useEffect(() => {
    let alive = true;
    void Promise.all([speech.canSpeak(langs.a), speech.canSpeak(langs.b)]).then(([a, b]) => {
      if (alive) setVoiceFor({ a, b });
    });
    return () => {
      alive = false;
    };
  }, [speech, langs.a, langs.b]);
  const canSpeakAny = voiceFor.a || voiceFor.b;

  // Announce new translations to VoiceOver.
  const announcedRef = useRef<string | undefined>(undefined);
  const { current: currentExchange } = state;
  useEffect(() => {
    if (currentExchange && currentExchange.id !== announcedRef.current) {
      announcedRef.current = currentExchange.id;
      AccessibilityInfo.announceForAccessibility?.(
        strings.translate.announceFmt(
          displayLanguageName(currentExchange.targetLang),
          currentExchange.translatedText,
        ),
      );
    }
  }, [currentExchange]);

  // --- Pickers / history ---
  const [picker, setPicker] = useState<Side | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const onPick = useCallback(
    (side: Side, lang: string) => {
      turn.setLang(side, lang);
      setPicker(null);
    },
    [turn],
  );

  const swapDisabled = !(state.status === 'idle' || state.status === 'showing' || state.status === 'error');

  // Offline / pack chip.
  const chip = (() => {
    if (catalog.availability && !catalog.availability.available) {
      const reason = catalog.availability.reason ?? strings.translate.translationUnavailable;
      return { text: reason, warn: true };
    }
    const aInstalled = getPackState(catalog.packs, langs.a) === 'installed';
    const bInstalled = getPackState(catalog.packs, langs.b) === 'installed';
    if (!catalog.loading && catalog.supported.length > 0 && (!aInstalled || !bInstalled)) {
      const missing = !aInstalled ? langs.a : langs.b;
      return { text: strings.translate.packMissingFmt(displayLanguageName(missing)), warn: true };
    }
    return { text: strings.translate.offlineReady, warn: false };
  })();

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {/* Top pane — the counterpart (side 'b'); rotated 180° unless solo. */}
      <Pane
        side="b"
        lang={langs.b}
        state={state}
        rotated={!solo}
        translatingTarget={lastActiveRef.current === 'a'}
        onLangPress={() => setPicker('b')}
        onMic={() => turn.onMicTap('b')}
        pulse={!reduceMotion}
      />

      {/* Center control bar. */}
      <View style={styles.centerBar}>
        <BarButton
          label="⇅"
          a11y={strings.translate.swap}
          onPress={turn.swapLangs}
          disabled={swapDisabled}
        />
        <SpeakToggle
          enabled={state.speakEnabled}
          disabled={!canSpeakAny}
          onToggle={() => turn.setSpeakEnabled(!state.speakEnabled)}
        />
        <BarButton
          label="🕘"
          a11y={strings.translate.history}
          onPress={() => setHistoryOpen(true)}
        />
        <BarButton
          label={solo ? '🔓' : '🔒'}
          a11y={strings.translate.soloMode}
          onPress={() => setSoloUser((s) => !s)}
          active={soloUser}
          disabled={screenReader}
        />
      </View>

      <View style={[styles.chip, chip.warn && styles.chipWarn]}>
        <Text
          style={[styles.chipText, chip.warn && styles.chipTextWarn]}
          accessibilityLiveRegion="polite"
        >
          {chip.warn ? '⚠︎ ' : '🔒 '}
          {chip.text}
        </Text>
      </View>

      {/* Bottom pane — the device holder (side 'a'). */}
      <Pane
        side="a"
        lang={langs.a}
        state={state}
        rotated={false}
        translatingTarget={lastActiveRef.current === 'b'}
        onLangPress={() => setPicker('a')}
        onMic={() => turn.onMicTap('a')}
        pulse={!reduceMotion}
      />

      {isAndroid ? (
        <Text style={styles.attribution} accessibilityRole="text">
          {strings.translate.poweredByGoogle}
        </Text>
      ) : null}

      {picker ? (
        <LangPickerModal
          side={picker}
          rows={catalog.usable}
          wifiOnly={settings.wifiOnlyDownloads}
          onWifiOnlyChange={(v) => persist({ wifiOnlyDownloads: v })}
          otherLang={langs[otherSide(picker)]}
          onPick={onPick}
          onDownloadPack={(lang, otherLang) =>
            catalog.downloadPack(lang, otherLang, settings.wifiOnlyDownloads)
          }
          onClose={() => setPicker(null)}
        />
      ) : null}

      {historyOpen ? (
        <HistorySheet
          state={state}
          onClear={turn.clearHistory}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}

// ---- Pane ------------------------------------------------------------------

function Pane({
  side,
  lang,
  state,
  rotated,
  translatingTarget,
  onLangPress,
  onMic,
  pulse,
}: {
  side: Side;
  lang: string;
  state: ReturnType<typeof useTranslatorTurn>['state'];
  rotated: boolean;
  translatingTarget: boolean;
  onLangPress: () => void;
  onMic: () => void;
  pulse: boolean;
}): React.ReactElement {
  const name = displayLanguageName(lang);
  const listening = state.status === 'listening' && state.activeSide === side;
  const translating = state.status === 'translating' && translatingTarget;
  const current = state.current;
  const targetsThisPane = !!current && otherSide(current.side) === side;

  let big = '';
  let small = '';
  let hint = '';
  if (listening) {
    big = state.partialText ?? '';
    hint = state.partialText ? '' : strings.translate.listeningFmt(name);
  } else if (translating) {
    hint = strings.translate.translating;
  } else if (targetsThisPane && current) {
    big = current.translatedText;
    small = current.sourceText;
  } else {
    hint = strings.translate.tapToSpeakFmt(name);
  }

  return (
    <View style={[styles.pane, rotated && styles.paneRotated]}>
      <Pressable
        style={styles.langPill}
        accessibilityRole="button"
        accessibilityLabel={`${name}. ${strings.translate.pickerTitleFmt(side === 'a' ? strings.translate.sideA : strings.translate.sideB)}`}
        onPress={onLangPress}
      >
        <Text style={styles.langPillText}>{name} ▾</Text>
      </Pressable>

      <View style={styles.paneBody}>
        {big ? (
          <Text
            style={styles.bigText}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
            numberOfLines={6}
          >
            {big}
          </Text>
        ) : (
          <Text style={styles.hintText}>{hint}</Text>
        )}
        {small ? (
          <Text style={styles.smallOriginal} numberOfLines={3}>
            {small}
          </Text>
        ) : null}
      </View>

      <TurnMic
        active={listening}
        label={listening ? strings.translate.stopListening : strings.translate.speakInFmt(name)}
        onPress={onMic}
        pulse={pulse}
      />
    </View>
  );
}

// ---- Mic button (pulse on active, respects Reduce Motion) ------------------

function TurnMic({
  active,
  label,
  onPress,
  pulse,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  pulse: boolean;
}): React.ReactElement {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (active && pulse) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.15, duration: 600, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 600, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    scale.setValue(1);
    return undefined;
  }, [active, pulse, scale]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      hitSlop={8}
      style={styles.micWrap}
    >
      <Animated.View
        style={[styles.micCircle, active && styles.micCircleActive, { transform: [{ scale }] }]}
      >
        <Text style={styles.micGlyph}>{active ? '■' : '🎙'}</Text>
      </Animated.View>
    </Pressable>
  );
}

// ---- Center-bar controls ---------------------------------------------------

function BarButton({
  label,
  a11y,
  onPress,
  disabled,
  active,
}: {
  label: string;
  a11y: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.barBtn, active && styles.barBtnActive, disabled && styles.barBtnDisabled]}
    >
      <Text style={styles.barBtnText}>{label}</Text>
    </Pressable>
  );
}

function SpeakToggle({
  enabled,
  disabled,
  onToggle,
}: {
  enabled: boolean;
  disabled: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={disabled ? strings.translate.speakOff : strings.translate.speakOn}
      accessibilityState={{ checked: enabled && !disabled, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={[styles.barBtn, enabled && !disabled && styles.barBtnActive, disabled && styles.barBtnDisabled]}
    >
      <Text style={styles.barBtnText}>{enabled && !disabled ? '🔊' : '🔇'}</Text>
    </Pressable>
  );
}

// ---- Language picker modal -------------------------------------------------

function badgeFor(row: UsableLang): { glyph: string; label: string; color: string } {
  switch (row.pack) {
    case 'installed':
      return { glyph: '✓', label: strings.translate.badgeInstalled, color: colors.success };
    case 'downloading':
      return { glyph: '⬇︎', label: strings.translate.badgeDownloading, color: colors.warning };
    case 'downloadable':
      return { glyph: '↓', label: strings.translate.badgeDownloadable, color: colors.violet };
    default:
      return { glyph: '✕', label: strings.translate.badgeUnsupported, color: colors.textFaint };
  }
}

function LangPickerModal({
  side,
  rows,
  wifiOnly,
  onWifiOnlyChange,
  otherLang,
  onPick,
  onDownloadPack,
  onClose,
}: {
  side: Side;
  rows: UsableLang[];
  wifiOnly: boolean;
  onWifiOnlyChange: (v: boolean) => void;
  otherLang: string;
  onPick: (side: Side, lang: string) => void;
  onDownloadPack: (lang: string, otherLang: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const isAndroid = Platform.OS === 'android';
  const title = strings.translate.pickerTitleFmt(
    side === 'a' ? strings.translate.sideA : strings.translate.sideB,
  );
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} visible>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={strings.common.close} onPress={onClose}>
              <Text style={styles.modalClose}>✕</Text>
            </Pressable>
          </View>

          {isAndroid ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: wifiOnly }}
              onPress={() => onWifiOnlyChange(!wifiOnly)}
              style={styles.wifiRow}
            >
              <Text style={styles.wifiBox}>{wifiOnly ? '☑' : '☐'}</Text>
              <Text style={styles.wifiLabel}>{strings.translate.wifiOnly}</Text>
            </Pressable>
          ) : null}

          <ScrollView style={styles.modalScroll}>
            {rows.map((row) => {
              const badge = badgeFor(row);
              const sttMissing = row.sttKnown && row.sttLocale === null;
              return (
                <View key={row.lang} style={styles.pickRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${row.displayName}. ${badge.label}`}
                    disabled={!row.usable}
                    onPress={() => onPick(side, row.lang)}
                    style={styles.pickMain}
                  >
                    <Text style={[styles.badge, { color: badge.color }]}>{badge.glyph}</Text>
                    <View style={styles.pickTextCol}>
                      <Text style={[styles.pickName, !row.usable && styles.pickNameDim]}>
                        {row.displayName}
                      </Text>
                      {row.pack === 'downloadable' ? (
                        <Text style={styles.pickSub}>{strings.translate.packSizeNote}</Text>
                      ) : null}
                      {sttMissing ? (
                        <Text style={styles.pickWarn}>
                          {isAndroid
                            ? strings.translate.sttMissingAndroid
                            : strings.translate.sttMissingIos}
                        </Text>
                      ) : null}
                      {!row.sttKnown ? (
                        <Text style={styles.pickSub}>{strings.translate.sttUnknown}</Text>
                      ) : null}
                    </View>
                  </Pressable>

                  {row.pack === 'downloadable' ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${strings.translate.download} ${row.displayName}`}
                      onPress={() => onDownloadPack(row.lang, otherLang)}
                      style={styles.pickDownload}
                    >
                      <Text style={styles.pickDownloadText}>{strings.translate.download}</Text>
                    </Pressable>
                  ) : row.pack === 'downloading' ? (
                    <Text style={styles.pickSub}>{strings.translate.downloading}</Text>
                  ) : null}

                  {sttMissing && isAndroid ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={strings.translate.sttMissingAndroidCta}
                      onPress={() => {
                        void triggerAndroidOfflineModelDownload(row.sttLocale ?? row.lang);
                      }}
                      style={styles.pickDownload}
                    >
                      <Text style={styles.pickDownloadText}>
                        {strings.translate.sttMissingAndroidCta}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---- History bottom sheet --------------------------------------------------

function HistorySheet({
  state,
  onClear,
  onClose,
}: {
  state: ReturnType<typeof useTranslatorTurn>['state'];
  onClear: () => void;
  onClose: () => void;
}): React.ReactElement {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} visible>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{strings.translate.history}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={strings.common.close} onPress={onClose}>
              <Text style={styles.modalClose}>✕</Text>
            </Pressable>
          </View>

          {state.history.length === 0 ? (
            <Text style={styles.hintText}>{strings.translate.emptyHistory}</Text>
          ) : (
            <ScrollView style={styles.modalScroll}>
              {state.history.map((ex) => (
                <View key={ex.id} style={styles.histRow}>
                  <Text style={styles.histSource}>{ex.sourceText}</Text>
                  <Text style={styles.histTarget}>{ex.translatedText}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${strings.translate.copy}: ${ex.translatedText}`}
                    onPress={() => {
                      void Clipboard.setStringAsync(ex.translatedText);
                      setCopiedId(ex.id);
                    }}
                  >
                    <Text style={styles.histCopy}>
                      {copiedId === ex.id ? strings.translate.copied : strings.translate.copy}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}

          {state.history.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.history.clearAll}
              onPress={() => {
                onClear();
                onClose();
              }}
              style={styles.clearBtn}
            >
              <Text style={styles.clearBtnText}>{strings.history.clearAll}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

// ---- Default export: wire the real singletons + settings store -------------

export function TranslateScreen(): React.ReactElement {
  const { settings, updateSettings, getSettings } = useAppState();
  const persist = useCallback(
    (patch: Partial<TranslatorSettings>) => {
      const cur = getSettings();
      void updateSettings({ ...cur, translator: { ...cur.translator, ...patch } });
    },
    [getSettings, updateSettings],
  );
  return (
    <TranslateScreenView
      translator={defaultTranslator}
      localStt={defaultLocalStt}
      speech={defaultSpeech}
      settings={settings.translator}
      persist={persist}
    />
  );
}

// ---- Styles ----------------------------------------------------------------

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pane: {
    flex: 1,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  paneRotated: { transform: [{ rotate: '180deg' }] },
  langPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  langPillText: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  paneBody: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  bigText: {
    color: colors.text,
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '700',
    textAlign: 'center',
  },
  hintText: { color: colors.textFaint, fontSize: font.body, textAlign: 'center', fontStyle: 'italic' },
  smallOriginal: { color: colors.textDim, fontSize: font.small, textAlign: 'center' },
  micWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xs },
  micCircle: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.violet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micCircleActive: { backgroundColor: colors.danger },
  micGlyph: { fontSize: 30, color: colors.white },
  centerBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  barBtn: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  barBtnActive: { backgroundColor: colors.violetDim, borderColor: colors.violet },
  barBtnDisabled: { opacity: 0.4 },
  barBtnText: { fontSize: 20, color: colors.text },
  chip: {
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: '92%',
  },
  chipWarn: { borderColor: colors.warning },
  chipText: { color: colors.textDim, fontSize: font.tiny, textAlign: 'center' },
  chipTextWarn: { color: colors.warning },
  attribution: {
    color: colors.textFaint,
    fontSize: font.tiny,
    textAlign: 'center',
    paddingVertical: spacing.xs,
  },
  // Modals
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    maxHeight: '85%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700' },
  modalClose: { color: colors.textDim, fontSize: font.heading, padding: spacing.xs },
  modalScroll: { flexGrow: 0 },
  wifiRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  wifiBox: { color: colors.violet, fontSize: font.body },
  wifiLabel: { color: colors.text, fontSize: font.small },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pickMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  badge: { fontSize: font.body, width: 22, textAlign: 'center' },
  pickTextCol: { flex: 1, gap: 2 },
  pickName: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  pickNameDim: { color: colors.textDim },
  pickSub: { color: colors.textFaint, fontSize: font.tiny },
  pickWarn: { color: colors.warning, fontSize: font.tiny },
  pickDownload: {
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.violet,
  },
  pickDownloadText: { color: colors.white, fontSize: font.small, fontWeight: '700' },
  histRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 2,
  },
  histSource: { color: colors.textDim, fontSize: font.small },
  histTarget: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  histCopy: { color: colors.violet, fontSize: font.small, fontWeight: '700', paddingVertical: spacing.xs },
  clearBtn: { alignSelf: 'center', paddingVertical: spacing.sm },
  clearBtnText: { color: colors.danger, fontSize: font.small, fontWeight: '700' },
});
