import { hopReducer, initialHopState, phaseForStatus } from './hopMode';

describe('phaseForStatus', () => {
  it('maps dictation statuses to hop phases', () => {
    expect(phaseForStatus('idle')).toBe('listening');
    expect(phaseForStatus('recording')).toBe('listening');
    expect(phaseForStatus('transcribing')).toBe('processing');
    expect(phaseForStatus('cleaning')).toBe('processing');
    expect(phaseForStatus('ready')).toBe('done');
    expect(phaseForStatus('error')).toBe('error');
  });
});

describe('hopReducer', () => {
  it('advances through listening → processing → done as statuses arrive', () => {
    let s = initialHopState('rid-1');
    expect(s.phase).toBe('listening');
    s = hopReducer(s, { type: 'DICTATION_STATUS', status: 'transcribing' });
    expect(s.phase).toBe('processing');
    s = hopReducer(s, { type: 'RESULT', ok: true, text: 'Hello.' });
    expect(s).toMatchObject({ phase: 'done', text: 'Hello.' });
  });

  it('captures errors from RESULT', () => {
    const s = hopReducer(initialHopState('rid-2'), {
      type: 'RESULT',
      ok: false,
      error: 'network down',
    });
    expect(s).toMatchObject({ phase: 'error', error: 'network down' });
  });

  it('does not regress out of a terminal phase on a late status', () => {
    const done = hopReducer(initialHopState('rid-3'), { type: 'RESULT', ok: true, text: 'x' });
    const after = hopReducer(done, { type: 'DICTATION_STATUS', status: 'recording' });
    expect(after.phase).toBe('done');
  });
});
