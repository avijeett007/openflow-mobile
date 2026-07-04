import type { DictationStatus } from '../hooks/useDictation';

/**
 * iOS keyboard "hop" mode. The keyboard opens `openflow://dictate?rid=<uuid>`;
 * the app foregrounds into a focused full-screen flow that auto-records, runs
 * STT+cleanup, writes the hand-off to the App Group, then tells the user to tap
 * the system "‹ Back" breadcrumb so the keyboard can insert the text.
 *
 * This reducer collapses the richer dictation status into the four phases the
 * hop UI cares about. Pure + tested.
 */

export type HopPhase = 'listening' | 'processing' | 'done' | 'error';

export interface HopState {
  rid: string;
  phase: HopPhase;
  text?: string;
  error?: string;
}

export function initialHopState(rid: string): HopState {
  return { rid, phase: 'listening' };
}

export type HopAction =
  | { type: 'DICTATION_STATUS'; status: DictationStatus }
  | { type: 'RESULT'; text?: string; error?: string; ok: boolean };

/** Map a dictation status to its hop phase. `idle`/`recording` → listening. */
export function phaseForStatus(status: DictationStatus): HopPhase {
  switch (status) {
    case 'idle':
    case 'recording':
      return 'listening';
    case 'transcribing':
    case 'cleaning':
      return 'processing';
    case 'ready':
      return 'done';
    case 'error':
      return 'error';
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

export function hopReducer(state: HopState, action: HopAction): HopState {
  switch (action.type) {
    case 'DICTATION_STATUS': {
      const phase = phaseForStatus(action.status);
      // Never regress out of a terminal phase on a stray late status.
      if (state.phase === 'done' || state.phase === 'error') return state;
      return { ...state, phase };
    }
    case 'RESULT':
      return action.ok
        ? { ...state, phase: 'done', text: action.text, error: undefined }
        : { ...state, phase: 'error', error: action.error };
    default: {
      const _never: never = action;
      return _never;
    }
  }
}
