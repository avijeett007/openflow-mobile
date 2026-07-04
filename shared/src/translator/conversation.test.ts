import {
  HISTORY_CAP,
  conversationReducer as reduce,
  initialConversationState,
  otherSide,
  type ConversationAction,
  type ConversationState,
  type Exchange,
  type Side,
  type TurnStatus,
} from './conversation';

function makeExchange(overrides: Partial<Exchange> = {}): Exchange {
  return {
    id: overrides.id ?? `ex-${Math.random().toString(36).slice(2, 10)}`,
    ts: 1720000000000,
    side: 'a',
    sourceLang: 'en',
    targetLang: 'es',
    sourceText: 'hello',
    translatedText: 'hola',
    spoken: false,
    ...overrides,
  };
}

/** Drive the machine through a full happy-path turn and return the state. */
function completedTurn(
  state = initialConversationState(),
  side: Side = 'a',
  exchange = makeExchange({ side }),
): ConversationState {
  let s = reduce(state, { type: 'MIC_TAP', side });
  s = reduce(s, { type: 'STT_FINAL', text: exchange.sourceText });
  return reduce(s, { type: 'TRANSLATED', exchange });
}

/** Build a state pinned at an arbitrary status (for exhaustive gating tests). */
function stateAt(status: TurnStatus): ConversationState {
  const base = initialConversationState();
  switch (status) {
    case 'idle':
      return base;
    case 'listening':
      return reduce(base, { type: 'MIC_TAP', side: 'a' });
    case 'translating':
      return reduce(stateAt('listening'), { type: 'STT_FINAL', text: 'hello' });
    case 'showing':
      return completedTurn();
    case 'speaking':
      return reduce(stateAt('showing'), { type: 'SPEAK_START' });
    case 'error':
      return reduce(stateAt('listening'), { type: 'ERROR', error: 'boom' });
  }
}

describe('initialConversationState', () => {
  it('starts idle with defaults', () => {
    expect(initialConversationState()).toEqual({
      status: 'idle',
      activeSide: null,
      langs: { a: 'en', b: 'es' },
      speakEnabled: true,
      history: [],
    });
  });

  it('accepts langs and speakEnabled overrides', () => {
    const s = initialConversationState({ langs: { a: 'de', b: 'ja' }, speakEnabled: false });
    expect(s.langs).toEqual({ a: 'de', b: 'ja' });
    expect(s.speakEnabled).toBe(false);
  });
});

describe('otherSide', () => {
  it('flips', () => {
    expect(otherSide('a')).toBe('b');
    expect(otherSide('b')).toBe('a');
  });
});

describe('MIC_TAP', () => {
  it('starts listening from idle on either side', () => {
    for (const side of ['a', 'b'] as const) {
      const s = reduce(initialConversationState(), { type: 'MIC_TAP', side });
      expect(s.status).toBe('listening');
      expect(s.activeSide).toBe(side);
    }
  });

  it('same-side tap while listening is a no-op (the hook stops STT → STT_FINAL)', () => {
    const listening = reduce(stateAt('listening'), { type: 'STT_PARTIAL', text: 'hel' });
    expect(reduce(listening, { type: 'MIC_TAP', side: 'a' })).toBe(listening);
  });

  it('other-side tap while listening cancels and restarts listening there', () => {
    let s = stateAt('listening'); // side a
    s = reduce(s, { type: 'STT_PARTIAL', text: 'hel' });
    const restarted = reduce(s, { type: 'MIC_TAP', side: 'b' });
    expect(restarted.status).toBe('listening');
    expect(restarted.activeSide).toBe('b');
    expect(restarted.partialText).toBeUndefined();
  });

  it('after a hand-off, the cancelled side’s stale STT events are dropped', () => {
    let s = reduce(stateAt('listening'), { type: 'MIC_TAP', side: 'b' });
    const afterStalePartial = reduce(s, { type: 'STT_PARTIAL', text: 'stale' });
    // Partial still applies (we ARE listening) — but a stale FINAL for side a
    // resolves as side b's turn only via the hook; reducer-wise the turn is b's.
    expect(afterStalePartial.activeSide).toBe('b');
    s = reduce(s, { type: 'STT_FINAL', text: 'hola' });
    expect(s.status).toBe('translating');
    expect(s.activeSide).toBe('b');
  });

  it('is ignored while translating (turn in flight)', () => {
    const s = stateAt('translating');
    expect(reduce(s, { type: 'MIC_TAP', side: 'a' })).toBe(s);
    expect(reduce(s, { type: 'MIC_TAP', side: 'b' })).toBe(s);
  });

  it('starts a new turn from showing, preserving current + history', () => {
    const shown = stateAt('showing');
    const s = reduce(shown, { type: 'MIC_TAP', side: 'b' });
    expect(s.status).toBe('listening');
    expect(s.activeSide).toBe('b');
    expect(s.current).toBe(shown.current);
    expect(s.history).toHaveLength(1);
  });

  it('barge-in: tap while speaking starts listening (hook stops TTS)', () => {
    const s = reduce(stateAt('speaking'), { type: 'MIC_TAP', side: 'b' });
    expect(s.status).toBe('listening');
    expect(s.activeSide).toBe('b');
  });

  it('recovers from error and clears the message', () => {
    const s = reduce(stateAt('error'), { type: 'MIC_TAP', side: 'a' });
    expect(s.status).toBe('listening');
    expect(s.error).toBeUndefined();
  });
});

describe('STT_PARTIAL', () => {
  it('updates the live partial while listening', () => {
    let s = reduce(stateAt('listening'), { type: 'STT_PARTIAL', text: 'hel' });
    s = reduce(s, { type: 'STT_PARTIAL', text: 'hello' });
    expect(s.partialText).toBe('hello');
    expect(s.status).toBe('listening');
  });

  it.each(['idle', 'translating', 'showing', 'speaking', 'error'] as const)(
    'is dropped as stale in %s',
    (status) => {
      const s = stateAt(status);
      expect(reduce(s, { type: 'STT_PARTIAL', text: 'late' })).toBe(s);
    },
  );
});

describe('STT_FINAL', () => {
  it('moves to translating with the trimmed transcript', () => {
    let s = reduce(stateAt('listening'), { type: 'STT_PARTIAL', text: 'hello th' });
    s = reduce(s, { type: 'STT_FINAL', text: '  hello there  ' });
    expect(s.status).toBe('translating');
    expect(s.pendingText).toBe('hello there');
    expect(s.partialText).toBeUndefined();
    expect(s.activeSide).toBe('a'); // turn owner retained for the hook
  });

  it.each(['', '   ', '\n\t'])('empty transcript (%j) returns to idle with no turn', (text) => {
    const s = reduce(stateAt('listening'), { type: 'STT_FINAL', text });
    expect(s.status).toBe('idle');
    expect(s.activeSide).toBeNull();
    expect(s.pendingText).toBeUndefined();
    expect(s.error).toBeUndefined();
    expect(s.history).toHaveLength(0);
  });

  it.each(['idle', 'translating', 'showing', 'speaking', 'error'] as const)(
    'is dropped as stale in %s',
    (status) => {
      const s = stateAt(status);
      expect(reduce(s, { type: 'STT_FINAL', text: 'late final' })).toBe(s);
    },
  );
});

describe('TRANSLATED', () => {
  it('shows the exchange and prepends it to history', () => {
    const ex = makeExchange({ id: 'first' });
    const s = completedTurn(initialConversationState(), 'a', ex);
    expect(s.status).toBe('showing');
    expect(s.current).toBe(ex);
    expect(s.history[0]).toBe(ex);
    expect(s.activeSide).toBeNull();
    expect(s.pendingText).toBeUndefined();
  });

  it('keeps newest first across turns', () => {
    let s = completedTurn(initialConversationState(), 'a', makeExchange({ id: 'one' }));
    s = completedTurn(s, 'b', makeExchange({ id: 'two', side: 'b' }));
    expect(s.history.map((e) => e.id)).toEqual(['two', 'one']);
    expect(s.current?.id).toBe('two');
  });

  it(`caps history at ${HISTORY_CAP}, dropping the oldest`, () => {
    let s = initialConversationState();
    for (let i = 0; i < HISTORY_CAP + 5; i++) {
      s = completedTurn(s, 'a', makeExchange({ id: `ex-${i}` }));
    }
    expect(s.history).toHaveLength(HISTORY_CAP);
    expect(s.history[0]?.id).toBe(`ex-${HISTORY_CAP + 4}`);
    expect(s.history[HISTORY_CAP - 1]?.id).toBe('ex-5'); // ex-0..ex-4 dropped
  });

  it.each(['idle', 'listening', 'showing', 'speaking', 'error'] as const)(
    'is dropped as superseded in %s',
    (status) => {
      const s = stateAt(status);
      expect(reduce(s, { type: 'TRANSLATED', exchange: makeExchange() })).toBe(s);
    },
  );

  it('a result racing a mid-translate error is dropped (no zombie exchange)', () => {
    // translate() rejects → ERROR; the (impossible-but-defensive) late
    // TRANSLATED for the same turn must not resurrect it.
    let s = reduce(stateAt('translating'), { type: 'ERROR', error: 'translate failed' });
    expect(s.status).toBe('error');
    const late = reduce(s, { type: 'TRANSLATED', exchange: makeExchange() });
    expect(late).toBe(s);
    expect(late.history).toHaveLength(0);
  });
});

describe('speak flow gating', () => {
  it('SPEAK_START from showing enters speaking and marks the exchange spoken (state + history)', () => {
    const shown = stateAt('showing');
    const s = reduce(shown, { type: 'SPEAK_START' });
    expect(s.status).toBe('speaking');
    expect(s.current?.spoken).toBe(true);
    expect(s.history[0]?.spoken).toBe(true);
    expect(s.history[0]).toBe(s.current);
  });

  it('SPEAK_START is ignored when speakEnabled is false', () => {
    const muted = reduce(stateAt('showing'), { type: 'SET_SPEAK_ENABLED', enabled: false });
    expect(reduce(muted, { type: 'SPEAK_START' })).toBe(muted);
  });

  it.each(['idle', 'listening', 'translating', 'speaking', 'error'] as const)(
    'SPEAK_START is ignored in %s',
    (status) => {
      const s = stateAt(status);
      expect(reduce(s, { type: 'SPEAK_START' })).toBe(s);
    },
  );

  it('SPEAK_DONE returns to showing (exchange stays spoken)', () => {
    const s = reduce(stateAt('speaking'), { type: 'SPEAK_DONE' });
    expect(s.status).toBe('showing');
    expect(s.current?.spoken).toBe(true);
  });

  it.each(['idle', 'listening', 'translating', 'showing', 'error'] as const)(
    'SPEAK_DONE is ignored in %s',
    (status) => {
      const s = stateAt(status);
      expect(reduce(s, { type: 'SPEAK_DONE' })).toBe(s);
    },
  );

  it('disabling speech mid-utterance drops back to showing', () => {
    const s = reduce(stateAt('speaking'), { type: 'SET_SPEAK_ENABLED', enabled: false });
    expect(s.status).toBe('showing');
    expect(s.speakEnabled).toBe(false);
  });

  it('SET_SPEAK_ENABLED toggles in any state without other side effects', () => {
    const s = reduce(stateAt('listening'), { type: 'SET_SPEAK_ENABLED', enabled: false });
    expect(s.status).toBe('listening');
    expect(s.speakEnabled).toBe(false);
  });
});

describe('ERROR (per-turn, non-fatal)', () => {
  it('enters error with the message and clears turn scratch', () => {
    let s = reduce(stateAt('listening'), { type: 'STT_PARTIAL', text: 'hel' });
    s = reduce(s, { type: 'ERROR', error: 'stt died' });
    expect(s.status).toBe('error');
    expect(s.error).toBe('stt died');
    expect(s.partialText).toBeUndefined();
    expect(s.pendingText).toBeUndefined();
    expect(s.activeSide).toBeNull();
  });

  it('preserves history and current across a failed turn', () => {
    const shown = completedTurn();
    let s = reduce(shown, { type: 'MIC_TAP', side: 'b' });
    s = reduce(s, { type: 'STT_FINAL', text: 'ça va' });
    s = reduce(s, { type: 'ERROR', error: 'pack missing' });
    expect(s.history).toHaveLength(1);
    expect(s.current).toBe(shown.current);
    // ...and a fresh turn works immediately after.
    const retried = completedTurn(s, 'b', makeExchange({ id: 'retry', side: 'b' }));
    expect(retried.status).toBe('showing');
    expect(retried.history.map((e) => e.id)).toEqual(['retry', shown.current!.id]);
    expect(retried.error).toBeUndefined();
  });
});

describe('SWAP_LANGS / SET_LANG gating', () => {
  it.each(['idle', 'showing', 'error'] as const)('SWAP_LANGS swaps when %s (no active turn)', (status) => {
    const s = reduce(stateAt(status), { type: 'SWAP_LANGS' });
    expect(s.langs).toEqual({ a: 'es', b: 'en' });
  });

  it.each(['listening', 'translating', 'speaking'] as const)(
    'SWAP_LANGS is ignored mid-turn (%s)',
    (status) => {
      const s = stateAt(status);
      expect(reduce(s, { type: 'SWAP_LANGS' })).toBe(s);
      expect(s.langs).toEqual({ a: 'en', b: 'es' });
    },
  );

  it('SET_LANG updates one side when idle', () => {
    const s = reduce(initialConversationState(), { type: 'SET_LANG', side: 'b', lang: 'de' });
    expect(s.langs).toEqual({ a: 'en', b: 'de' });
  });

  it.each(['listening', 'translating', 'speaking'] as const)(
    'SET_LANG is ignored mid-turn (%s)',
    (status) => {
      const s = stateAt(status);
      expect(reduce(s, { type: 'SET_LANG', side: 'a', lang: 'fr' })).toBe(s);
    },
  );
});

describe('RESET / CLEAR_HISTORY', () => {
  it('RESET abandons the turn but keeps langs, speak toggle, current and history', () => {
    let s = completedTurn();
    s = reduce(s, { type: 'SET_SPEAK_ENABLED', enabled: false });
    s = reduce(s, { type: 'MIC_TAP', side: 'b' });
    s = reduce(s, { type: 'RESET' });
    expect(s.status).toBe('idle');
    expect(s.activeSide).toBeNull();
    expect(s.speakEnabled).toBe(false);
    expect(s.history).toHaveLength(1);
    expect(s.current).toBeDefined();
  });

  it('CLEAR_HISTORY empties history and, when showing, returns to idle', () => {
    const s = reduce(stateAt('showing'), { type: 'CLEAR_HISTORY' });
    expect(s.history).toEqual([]);
    expect(s.current).toBeUndefined();
    expect(s.status).toBe('idle');
  });

  it('CLEAR_HISTORY does not interrupt an active listen', () => {
    const s = reduce(stateAt('listening'), { type: 'CLEAR_HISTORY' });
    expect(s.status).toBe('listening');
    expect(s.history).toEqual([]);
  });
});

describe('exhaustive status coverage', () => {
  // Every (status × action-type) pair produces a defined state — no throws,
  // no undefined statuses. Guards against forgotten transitions.
  const statuses: TurnStatus[] = ['idle', 'listening', 'translating', 'showing', 'speaking', 'error'];
  const actions: ConversationAction[] = [
    { type: 'MIC_TAP', side: 'a' },
    { type: 'MIC_TAP', side: 'b' },
    { type: 'STT_PARTIAL', text: 'x' },
    { type: 'STT_FINAL', text: 'x' },
    { type: 'STT_FINAL', text: ' ' },
    { type: 'TRANSLATED', exchange: makeExchange() },
    { type: 'SPEAK_START' },
    { type: 'SPEAK_DONE' },
    { type: 'ERROR', error: 'e' },
    { type: 'SWAP_LANGS' },
    { type: 'SET_LANG', side: 'a', lang: 'fr' },
    { type: 'SET_SPEAK_ENABLED', enabled: false },
    { type: 'RESET' },
    { type: 'CLEAR_HISTORY' },
  ];

  it.each(statuses)('all actions are total from %s', (status) => {
    for (const action of actions) {
      const next = reduce(stateAt(status), action);
      expect(statuses).toContain(next.status);
      expect(next.history.length).toBeLessThanOrEqual(HISTORY_CAP);
    }
  });
});
