import { z } from 'zod';
import { OpenFlowError } from '../errors';

/**
 * iOS App-Group hand-off payload. Written by the container app to the shared
 * App Group; read by the keyboard extension. The Swift side mirrors this exact
 * JSON shape, so keep it FLAT and STABLE — additive changes only.
 */
export const DictationStatusSchema = z.enum([
  'recording',
  'transcribing',
  'cleaning',
  'ready',
  'error',
]);
export type DictationStatus = z.infer<typeof DictationStatusSchema>;

export const DictationHandoffSchema = z.object({
  /** Request id correlating the keyboard tap with the app's result. */
  rid: z.string().min(1),
  status: DictationStatusSchema,
  /** Present (typically) when status is `ready`. */
  text: z.string().optional(),
  /** Present when status is `error`. */
  error: z.string().optional(),
});
export type DictationHandoff = z.infer<typeof DictationHandoffSchema>;

/** Error thrown when a hand-off payload fails to decode/validate. */
export class HandoffDecodeError extends OpenFlowError {}

/** Serialize a hand-off payload to its canonical JSON string. */
export function encodeHandoff(handoff: DictationHandoff): string {
  const validated = DictationHandoffSchema.parse(handoff);
  return JSON.stringify(validated);
}

/**
 * Parse and validate a hand-off JSON string.
 * @throws {@link HandoffDecodeError} on malformed JSON or schema violation.
 */
export function decodeHandoff(input: string): DictationHandoff {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new HandoffDecodeError('Hand-off payload is not valid JSON');
  }
  const result = DictationHandoffSchema.safeParse(parsed);
  if (!result.success) {
    throw new HandoffDecodeError(`Invalid hand-off payload: ${result.error.message}`);
  }
  return result.data;
}
