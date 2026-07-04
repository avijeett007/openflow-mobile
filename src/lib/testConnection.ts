import {
  type CleanupSettings,
  type Prompt,
  type SttSettings,
  cleanTranscript,
  transcribe,
} from '@openflow/shared';
import { makeSampleAudio } from './sampleAudio';

/** Result of a settings "Test connection" action. */
export interface TestResult {
  ok: boolean;
  /** Human-readable detail on failure (or a short note on success). */
  detail?: string;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Exercise the STT endpoint with a tiny synthetic silent clip. A pass proves
 * auth + connectivity + a well-shaped response; the transcript itself is
 * expected to be empty/near-empty.
 */
export async function testSttConnection(
  settings: SttSettings,
  apiKey: string,
  fetchImpl?: typeof fetch,
): Promise<TestResult> {
  try {
    const audio = makeSampleAudio();
    const { text } = await transcribe({ settings, audio, apiKey, fetchImpl });
    return { ok: true, detail: text.trim() ? `Heard: "${text.trim()}"` : 'Endpoint reachable.' };
  } catch (err) {
    return { ok: false, detail: describeError(err) };
  }
}

/** Exercise the cleanup endpoint with a short sample transcript. */
export async function testCleanupConnection(
  settings: CleanupSettings,
  apiKey: string,
  prompts?: Prompt[],
  fetchImpl?: typeof fetch,
): Promise<TestResult> {
  try {
    const { text } = await cleanTranscript({
      settings,
      transcript: 'this is a test of open flow cleanup please fix any obvious issues',
      apiKey,
      prompts,
      fetchImpl,
    });
    return { ok: true, detail: text.trim() ? 'Cleanup responded.' : 'Empty response.' };
  } catch (err) {
    return { ok: false, detail: describeError(err) };
  }
}
