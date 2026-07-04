/**
 * conversation.ts — the face-to-face translation turn state machine.
 *
 * Pure reducer in the `dictationReducer` mold (exhaustive switch, never-typed
 * default). The async work (STT via localStt, identifyLanguage, translate,
 * speak) lives in T3's `useTranslatorTurn` hook, which dispatches these
 * actions; the reducer alone decides what is a legal transition, so stale
 * async results (a cancelled turn's STT_FINAL, a superseded TRANSLATED) are
 * dropped here rather than guarded in the hook.
 */

// ---- Core types -------------------------------------------------------------

/** Which physical pane / mic: 'a' (bottom, device holder) or 'b' (top, counterpart). */
export type Side = 'a' | 'b';

export function otherSide(side: Side): Side {
  return side === 'a' ? 'b' : 'a';
}

/**
 * Turn lifecycle:
 * idle → (MIC_TAP) listening → (STT_FINAL) translating → (TRANSLATED) showing
 * → (SPEAK_START) speaking → (SPEAK_DONE) showing. `error` is per-turn and
 * non-fatal — history survives and any MIC_TAP starts a fresh turn.
 */
export type TurnStatus = 'idle' | 'listening' | 'translating' | 'showing' | 'speaking' | 'error';

/** One completed translation turn (newest-first in history). */
export interface Exchange {
  id: string;
  /** Epoch ms when the turn completed. */
  ts: number;
  /** The side that SPOKE (post auto-detect flip, if any). */
  side: Side;
  sourceLang: string;
  targetLang: string;
  sourceText: string;
  translatedText: string;
  /** identifyLanguage() result when auto-detect ran. */
  detectedLang?: string;
  /** TTS was started for this exchange. */
  spoken: boolean;
}

/** History keeps at most this many exchanges (newest first). */
export const HISTORY_CAP = 50;

export interface ConversationState {
  status: TurnStatus;
  /** Side owning the in-flight turn (listening/translating); null otherwise. */
  activeSide: Side | null;
  /** Current language of each side (translation codes from the platform list). */
  langs: { a: string; b: string };
  /** User's speak toggle — gates SPEAK_START. */
  speakEnabled: boolean;
  /** Live interim transcript while listening. */
  partialText?: string;
  /** Finalized source text while translating. */
  pendingText?: string;
  /** Last completed exchange (=== history[0] once TRANSLATED lands). */
  current?: Exchange;
  /** Completed exchanges, newest first, capped at {@link HISTORY_CAP}. */
  history: Exchange[];
  /** Message for the per-turn, non-fatal error state. */
  error?: string;
}

export type ConversationAction =
  /** A mic button was tapped. Same-side tap while listening is a reducer no-op —
   *  the hook stops STT, which lands as STT_FINAL. Other-side tap while
   *  listening cancels the turn and restarts listening on that side. */
  | { type: 'MIC_TAP'; side: Side }
  | { type: 'STT_PARTIAL'; text: string }
  /** Final transcript. Empty/whitespace → straight back to idle (no turn). */
  | { type: 'STT_FINAL'; text: string }
  /** Translation finished. The exchange is fully built by the hook (post
   *  auto-detect flip), so the reducer never re-derives languages. */
  | { type: 'TRANSLATED'; exchange: Exchange }
  /** TTS started for `current`. Gated: only from `showing`, only when
   *  `speakEnabled`, only with a current exchange. */
  | { type: 'SPEAK_START' }
  | { type: 'SPEAK_DONE' }
  /** Per-turn failure (STT, missing pack, translate error). Non-fatal. */
  | { type: 'ERROR'; error: string }
  /** Swap A↔B languages. Only outside an active turn (idle/showing/error);
   *  ignored while listening/translating/speaking. */
  | { type: 'SWAP_LANGS' }
  /** Change one side's language. Same gating as SWAP_LANGS. */
  | { type: 'SET_LANG'; side: Side; lang: string }
  | { type: 'SET_SPEAK_ENABLED'; enabled: boolean }
  /** Abandon any in-flight turn; keep langs, speak toggle and history. */
  | { type: 'RESET' }
  | { type: 'CLEAR_HISTORY' };

export const DEFAULT_LANGS: { a: string; b: string } = { a: 'en', b: 'es' };

export function initialConversationState(
  opts: { langs?: { a: string; b: string }; speakEnabled?: boolean } = {},
): ConversationState {
  return {
    status: 'idle',
    activeSide: null,
    langs: opts.langs ?? { ...DEFAULT_LANGS },
    speakEnabled: opts.speakEnabled ?? true,
    history: [],
  };
}

// ---- Reducer ----------------------------------------------------------------

/** States with no turn in flight — language changes are allowed here. */
function turnIdle(status: TurnStatus): boolean {
  return status === 'idle' || status === 'showing' || status === 'error';
}

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  switch (action.type) {
    case 'MIC_TAP': {
      if (state.status === 'listening') {
        // Same side: the hook stops STT and STT_FINAL drives the transition.
        if (action.side === state.activeSide) return state;
        // Other side: cancel + restart listening there (spec-mandated hand-off).
        return {
          ...state,
          activeSide: action.side,
          partialText: undefined,
          pendingText: undefined,
          error: undefined,
        };
      }
      // A translate is a short in-flight await — ignore taps until it settles.
      if (state.status === 'translating') return state;
      // idle / showing / speaking (barge-in; hook stops TTS on leaving 'speaking') / error.
      return {
        ...state,
        status: 'listening',
        activeSide: action.side,
        partialText: undefined,
        pendingText: undefined,
        error: undefined,
      };
    }

    case 'STT_PARTIAL':
      // Stale partials after a cancel/hand-off are dropped.
      if (state.status !== 'listening') return state;
      return { ...state, partialText: action.text };

    case 'STT_FINAL': {
      if (state.status !== 'listening') return state; // stale finalization
      const text = action.text.trim();
      if (!text) {
        // Nothing was said — no turn, no error.
        return { ...state, status: 'idle', activeSide: null, partialText: undefined };
      }
      return { ...state, status: 'translating', partialText: undefined, pendingText: text };
    }

    case 'TRANSLATED': {
      if (state.status !== 'translating') return state; // superseded turn
      const history = [action.exchange, ...state.history].slice(0, HISTORY_CAP);
      return {
        ...state,
        status: 'showing',
        activeSide: null,
        pendingText: undefined,
        current: action.exchange,
        history,
      };
    }

    case 'SPEAK_START': {
      // Speak-flow gating: visible result + toggle on, else the action is ignored.
      if (state.status !== 'showing' || !state.speakEnabled || !state.current) return state;
      const spokenCurrent: Exchange = { ...state.current, spoken: true };
      return {
        ...state,
        status: 'speaking',
        current: spokenCurrent,
        history: state.history.map((e) => (e.id === spokenCurrent.id ? spokenCurrent : e)),
      };
    }

    case 'SPEAK_DONE':
      if (state.status !== 'speaking') return state;
      return { ...state, status: 'showing' };

    case 'ERROR':
      // Non-fatal: the turn dies, the conversation (history/current/langs) survives.
      return {
        ...state,
        status: 'error',
        activeSide: null,
        partialText: undefined,
        pendingText: undefined,
        error: action.error,
      };

    case 'SWAP_LANGS':
      if (!turnIdle(state.status)) return state; // mid-turn swap is ignored
      return { ...state, langs: { a: state.langs.b, b: state.langs.a } };

    case 'SET_LANG':
      if (!turnIdle(state.status)) return state;
      return { ...state, langs: { ...state.langs, [action.side]: action.lang } };

    case 'SET_SPEAK_ENABLED': {
      const next = { ...state, speakEnabled: action.enabled };
      // Turning speech off mid-utterance drops back to showing; the hook
      // observes the exit from 'speaking' and stops TTS.
      if (!action.enabled && state.status === 'speaking') next.status = 'showing';
      return next;
    }

    case 'RESET':
      return {
        ...initialConversationState({ langs: state.langs, speakEnabled: state.speakEnabled }),
        current: state.current,
        history: state.history,
      };

    case 'CLEAR_HISTORY': {
      const status =
        state.status === 'showing' || state.status === 'speaking' ? 'idle' : state.status;
      return { ...state, status, history: [], current: undefined };
    }

    default: {
      const _never: never = action;
      return _never;
    }
  }
}
