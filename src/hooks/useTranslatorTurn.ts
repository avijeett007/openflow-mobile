import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  type ConversationState,
  type Exchange,
  type Side,
  conversationReducer,
  initialConversationState,
  langKey,
  otherSide,
  pickSttLocale,
} from '@openflow/shared';
import type { LocalStt } from '../lib/localStt';
import { strings } from '../strings';

/**
 * useTranslatorTurn — the face-to-face translation turn orchestrator.
 *
 * Deliberately NOT built on `useDictation` (no LLM cleanup, no dictation
 * history, no audio-clip upload). It drives the SHARED `conversationReducer`
 * (T1) — the reducer alone decides legal transitions, so this hook stays a thin
 * async runner: it starts/stops the on-device recognizer, (optionally) runs
 * language identification, calls the translator, and (optionally) speaks the
 * result, dispatching reducer actions as each step lands.
 *
 * MIC_TAP flow:
 *   idle/showing/error tap  → listening → STT → STT_FINAL → translating
 *                            → translate() → TRANSLATED → showing
 *                            → (speakEnabled ∧ canSpeak) SPEAK_START → speak()
 *                            → SPEAK_DONE
 *   same-side tap while listening → stop STT (→ STT_FINAL)
 *   other-side tap while listening → hand-off (cancel + restart on that side)
 *   tap while translating → ignored (reducer no-op)
 *   tap while speaking → BARGE-IN: stop TTS first, then start a fresh turn
 *
 * All async work is guarded by a generation counter so a superseded turn's
 * late results are dropped (belt-and-suspenders on top of the reducer's own
 * stale-event dropping).
 */

// ---- Injected collaborators (structural — real impls or test mocks) --------

export interface TurnTranslator {
  translate(text: string, from: string, to: string): Promise<{ text: string }>;
  identifyLanguage(text: string): Promise<string | null>;
}

export interface TurnSpeech {
  canSpeak(lang: string): Promise<boolean>;
  speak(text: string, lang: string): Promise<void>;
  stop(): Promise<void>;
}

export interface UseTranslatorTurnOptions {
  localStt: LocalStt;
  translator: TurnTranslator;
  speech: TurnSpeech;
  /** Device STT locales, to map a translation lang → recognizer locale. `null`/absent = unknown. */
  sttLocales?: readonly string[] | null;
  initialLangs?: { a: string; b: string };
  initialSpeakEnabled?: boolean;
  /** When true, identify the spoken language and flip direction if it's the other side's. */
  autoDetect?: boolean;
  /** Persist languages after a user change (fired only when the change is applied). */
  onLangsChange?: (langs: { a: string; b: string }) => void;
  /** Persist the speak toggle after a user change. */
  onSpeakEnabledChange?: (enabled: boolean) => void;
  now?: () => number;
  makeId?: () => string;
}

export interface UseTranslatorTurnApi {
  state: ConversationState;
  /** A mic button was tapped for `side`. Fire-and-forget. */
  onMicTap: (side: Side) => void;
  setLang: (side: Side, lang: string) => void;
  swapLangs: () => void;
  setSpeakEnabled: (enabled: boolean) => void;
  clearHistory: () => void;
  reset: () => void;
}

const defaultMakeId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Whether two language codes are the same language (primary + Chinese script). */
function sameLanguage(a: string, b: string): boolean {
  return langKey(a) === langKey(b);
}

/** States with no in-flight turn — a language/speak change is allowed to persist. */
function turnIdle(status: ConversationState['status']): boolean {
  return status === 'idle' || status === 'showing' || status === 'error';
}

export function useTranslatorTurn(options: UseTranslatorTurnOptions): UseTranslatorTurnApi {
  const {
    localStt,
    translator,
    speech,
    sttLocales,
    initialLangs,
    initialSpeakEnabled,
    autoDetect,
    onLangsChange,
    onSpeakEnabledChange,
    now = Date.now,
    makeId = defaultMakeId,
  } = options;

  const [state, dispatch] = useReducer(
    conversationReducer,
    { langs: initialLangs, speakEnabled: initialSpeakEnabled },
    initialConversationState,
  );

  // Live refs so async callbacks always read the freshest values.
  const stateRef = useRef(state);
  stateRef.current = state;
  const autoDetectRef = useRef(autoDetect);
  autoDetectRef.current = autoDetect;
  const sttLocalesRef = useRef(sttLocales);
  sttLocalesRef.current = sttLocales;
  /** Turn generation — bumped when a turn is superseded; guards stale async. */
  const genRef = useRef(0);
  const prevStatusRef = useRef(state.status);

  /** Map a translation-language code to the best on-device recognizer locale. */
  const sttLocaleFor = useCallback((lang: string): string => {
    const locales = sttLocalesRef.current;
    if (!locales) return lang; // unknown enumeration — hand the bare code to the recognizer
    return pickSttLocale(lang, locales) ?? lang;
  }, []);

  // Whenever the machine LEAVES 'speaking' without our own SPEAK_DONE (toggle
  // off mid-utterance, or a hand-off), make sure the TTS actually stops.
  useEffect(() => {
    if (prevStatusRef.current === 'speaking' && state.status !== 'speaking') {
      void speech.stop();
    }
    prevStatusRef.current = state.status;
  }, [state.status, speech]);

  /** Begin on-device recognition for `side` (status is already 'listening'). */
  const beginStt = useCallback(
    async (side: Side): Promise<void> => {
      const lang = stateRef.current.langs[side];
      const locale = sttLocaleFor(lang);
      const availability = await localStt.isAvailable(locale);
      if (!availability.available) {
        dispatch({ type: 'ERROR', error: availability.reason ?? strings.translate.sttUnavailable });
        return;
      }
      const granted = await localStt.requestPermission();
      if (!granted) {
        dispatch({ type: 'ERROR', error: strings.translate.permissionDenied });
        return;
      }
      try {
        await localStt.start({
          lang: locale,
          onPartial: (text) => dispatch({ type: 'STT_PARTIAL', text }),
        });
      } catch (err) {
        dispatch({ type: 'ERROR', error: describeSttError(err) });
      }
    },
    [localStt, sttLocaleFor],
  );

  /** From a finalized transcript: (auto-detect flip →) translate → speak. */
  const runTranslate = useCallback(
    async (sourceText: string, spokenSide: Side): Promise<void> => {
      const gen = genRef.current;
      const langs = stateRef.current.langs;

      let side = spokenSide;
      let sourceLang = langs[spokenSide];
      let targetLang = langs[otherSide(spokenSide)];
      let detectedLang: string | undefined;

      try {
        if (autoDetectRef.current) {
          const detected = await translator.identifyLanguage(sourceText).catch(() => null);
          if (gen !== genRef.current) return; // superseded
          if (detected) {
            detectedLang = detected;
            const otherLang = langs[otherSide(spokenSide)];
            // Grabbed the wrong mic: the OTHER side's language was spoken → flip.
            if (sameLanguage(detected, otherLang) && !sameLanguage(detected, langs[spokenSide])) {
              side = otherSide(spokenSide);
              sourceLang = otherLang;
              targetLang = langs[spokenSide];
            }
          }
        }

        const { text } = await translator.translate(sourceText, sourceLang, targetLang);
        if (gen !== genRef.current) return;

        const exchange: Exchange = {
          id: makeId(),
          ts: now(),
          side,
          sourceLang,
          targetLang,
          sourceText,
          translatedText: text,
          detectedLang,
          spoken: false,
        };
        dispatch({ type: 'TRANSLATED', exchange });

        // Optional TTS — gated by the toggle AND an installed voice.
        if (stateRef.current.speakEnabled && (await speech.canSpeak(targetLang))) {
          if (gen !== genRef.current) return;
          dispatch({ type: 'SPEAK_START' });
          try {
            await speech.speak(text, targetLang);
          } finally {
            dispatch({ type: 'SPEAK_DONE' });
          }
        }
      } catch (err) {
        if (gen !== genRef.current) return;
        dispatch({ type: 'ERROR', error: describeTranslateError(err) });
      }
    },
    [translator, speech, now, makeId],
  );

  const onMicTap = useCallback(
    (side: Side): void => {
      void (async () => {
        const st = stateRef.current;

        // A translate is a short in-flight await — ignore taps until it settles.
        if (st.status === 'translating') return;

        if (st.status === 'listening') {
          if (side === st.activeSide) {
            // Same side: stop the recognizer; its transcript drives STT_FINAL.
            let transcript = '';
            try {
              ({ transcript } = await localStt.stop());
            } catch (err) {
              dispatch({ type: 'ERROR', error: describeSttError(err) });
              return;
            }
            dispatch({ type: 'STT_FINAL', text: transcript });
            if (transcript.trim()) await runTranslate(transcript.trim(), side);
            return;
          }
          // Other side while listening: reducer flips activeSide; cancel + restart.
          genRef.current += 1;
          dispatch({ type: 'MIC_TAP', side });
          await localStt.cancel();
          await beginStt(side);
          return;
        }

        // idle / showing / error / speaking (barge-in).
        if (st.status === 'speaking') {
          await speech.stop(); // barge-in: silence the current utterance first
        }
        genRef.current += 1;
        dispatch({ type: 'MIC_TAP', side });
        await beginStt(side);
      })();
    },
    [localStt, speech, beginStt, runTranslate],
  );

  const setLang = useCallback(
    (side: Side, lang: string): void => {
      const st = stateRef.current;
      if (!turnIdle(st.status)) return; // reducer would ignore mid-turn anyway
      dispatch({ type: 'SET_LANG', side, lang });
      onLangsChange?.({ ...st.langs, [side]: lang });
    },
    [onLangsChange],
  );

  const swapLangs = useCallback((): void => {
    const st = stateRef.current;
    if (!turnIdle(st.status)) return;
    dispatch({ type: 'SWAP_LANGS' });
    onLangsChange?.({ a: st.langs.b, b: st.langs.a });
  }, [onLangsChange]);

  const setSpeakEnabled = useCallback(
    (enabled: boolean): void => {
      dispatch({ type: 'SET_SPEAK_ENABLED', enabled });
      onSpeakEnabledChange?.(enabled);
    },
    [onSpeakEnabledChange],
  );

  const clearHistory = useCallback((): void => {
    genRef.current += 1;
    void speech.stop();
    dispatch({ type: 'CLEAR_HISTORY' });
  }, [speech]);

  const reset = useCallback((): void => {
    genRef.current += 1;
    void localStt.cancel();
    void speech.stop();
    dispatch({ type: 'RESET' });
  }, [localStt, speech]);

  return { state, onMicTap, setLang, swapLangs, setSpeakEnabled, clearHistory, reset };
}

// ---- Honest error copy -----------------------------------------------------

function describeSttError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg && msg.trim() ? msg : strings.translate.sttFailed;
}

function describeTranslateError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg && msg.trim() ? msg : strings.translate.translateFailed;
}
