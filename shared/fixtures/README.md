# Contract fixtures

These JSON files capture the **exact HTTP surface** of the `@openflow/shared` STT
and cleanup clients, plus canonical hand-off payloads. They are the source of
truth for the **Kotlin IME (chunk C4)**, whose HTTP mirror must be contract-tested
against them.

`../src/fixtures.test.ts` binds these files to the real TS client behaviour, so
they cannot silently drift.

## Files
| File | What it pins |
| --- | --- |
| `stt-groq.json` | OpenAI-compatible multipart `POST /v1/audio/transcriptions` (Groq base), `Bearer` auth, multipart fields `file,model,response_format`, `{ text }` response. |
| `stt-openai.json` | Same contract against the OpenAI base. |
| `stt-deepgram.json` | Deepgram batch `POST /v1/listen?model=&smart_format=true`, `Token` auth, raw-bytes body, `results.channels[0].alternatives[0].transcript` response. |
| `cleanup-groq.json` | OpenAI-compatible `POST /v1/chat/completions`, `Bearer` auth, `system`+`user` messages, `temperature 0.2`, `stream false`, `choices[0].message.content` response. |
| `cleanup-ollama.json` | Same chat contract against a local Ollama base with **no** `Authorization` header. |
| `handoff-samples.json` | Canonical iOS App-Group hand-off JSON (flat `{ rid, status, text?, error? }`) plus invalid payloads. |

## Conventions
- `<API_KEY>` in headers is a placeholder — the real key is injected from secure
  storage at call time and NEVER stored in a fixture.
- `bytesUtf8` is placeholder audio content encoded as UTF-8 for reproducibility;
  real audio is raw bytes of the same mime type.
- The `request` block documents method, URL (including query string), header
  names, and (for cleanup) the JSON body shape. The Kotlin mirror should emit an
  identical request.
