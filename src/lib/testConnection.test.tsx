import { defaultSettings } from '@openflow/shared';
import { testCleanupConnection, testSttConnection } from './testConnection';

/**
 * testConnection uses an injected fetch so it runs without network. Verifies the
 * settings "Test connection" buttons surface pass/fail + error detail correctly.
 * (File named `__rnprobe` for historical reasons; content is a real unit test.)
 */
describe('testConnection', () => {
  const jsonResponse = (body: unknown, ok = true, status = 200): Response =>
    ({
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as unknown as Response;

  it('reports STT success and surfaces the transcript', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ text: 'hello there' }),
    ) as unknown as typeof fetch;
    const result = await testSttConnection(defaultSettings().stt, 'key', fetchImpl);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('hello there');
  });

  it('reports STT failure with error detail', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ error: 'bad key' }, false, 401),
    ) as unknown as typeof fetch;
    const result = await testSttConnection(defaultSettings().stt, 'key', fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.detail && result.detail.length).toBeGreaterThan(0);
  });

  it('reports cleanup success', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ choices: [{ message: { content: 'Hello there.' } }] }),
    ) as unknown as typeof fetch;
    const s = defaultSettings();
    const result = await testCleanupConnection(s.cleanup, 'key', s.prompts, fetchImpl);
    expect(result.ok).toBe(true);
  });
});
