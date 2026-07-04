# OpenFlow Mobile — Privacy Policy

_Draft, intended to be published at `https://openflow.computer/mobile-privacy`. Update the "Last
updated" date whenever this changes._

**Last updated:** 2026-07-04

This is a plain-language description of what OpenFlow Mobile does and doesn't do with your data.
No legal filler — if something below seems too short, it's because there isn't more to say.

## The short version

OpenFlow Mobile (the app and its keyboard) does not have a server, and we don't collect your
audio, transcripts, or usage data. Everything OpenFlow does happens either on your device or
between your device and the AI provider **you** configured.

## What gets recorded, and where it goes

- Audio is only recorded when you actively start a dictation (tap the mic). There is no
  background listening and no wake word on mobile.
- That audio is sent **directly** from your device to the speech-to-text endpoint you configured
  in Settings — Groq, OpenAI, Deepgram, or a custom/self-hosted URL — using the API key you
  supplied for that provider.
- If you've enabled AI cleanup, the resulting transcript is sent **directly** to the cleanup
  provider you configured (Groq, OpenAI, OpenRouter, Ollama, or custom), again with your key.
- OpenFlow does not run a backend that sees this traffic. We are not a party to that network
  request; it goes from your device to the provider you chose, over HTTPS (or to `localhost` if
  you're running Ollama).

## What's stored, and where

- **API keys**: stored in your device's secure storage — the iOS Keychain (shared with the
  keyboard extension via an App Group / access group) or Android
  `EncryptedSharedPreferences`. Never written to plaintext files, never sent to us.
- **Dictation history and transcripts**: stored only in the app's local, on-device storage. There
  is no cloud sync and no OpenFlow account. Uninstalling the app removes this data. You can also
  clear history from within the app.
- **Settings** (which providers/models you've picked, prompts, privacy mode): stored locally,
  same as history.
- **Analytics** (word counts, time-saved estimates, provider usage counts): computed from your
  local history, on your device, for your own viewing. Never transmitted anywhere.

## Privacy modes

OpenFlow Mobile has adjustable privacy modes that control how much detail your local history
keeps:

- **Full** — stores the transcript and which app you were dictating into.
- **Keywords only** — the text itself isn't stored, only metadata (word count, duration, which
  providers were used).
- **Off** — no per-dictation record is kept at all beyond aggregate counts.

These only affect what's stored **on your device**; they don't change what's sent to your
configured STT/cleanup provider, since that's required for dictation to work at all.

## Full Access (iOS)

iOS keyboard extensions cannot access the microphone under any circumstance — this is an Apple
sandbox restriction that applies to every custom keyboard, not something OpenFlow chose. When you
tap the mic in the OpenFlow keyboard, iOS opens the OpenFlow app to record and process your
speech, then hands the result back to the keyboard.

Reading that result back requires the keyboard to have **Full Access** enabled (Settings →
General → Keyboard → Keyboards → OpenFlow → Allow Full Access). Full Access on iOS technically
also permits network access from the keyboard extension itself, but **the OpenFlow keyboard
extension never makes a network call** — all networking happens in the container app. Full
Access is used solely to read the dictation result and your settings from an App Group shared
between the app and the keyboard. Without Full Access, the keyboard still works as a normal
QWERTY keyboard — you just won't be able to dictate.

## Third parties

The only third parties involved are the STT/cleanup providers **you** choose to configure (e.g.
Groq, OpenAI, Deepgram, OpenRouter, or your own self-hosted endpoint). Their handling of your
audio/text is governed by their own privacy policies, not this one. OpenFlow does not share data
with any other third party — there's no analytics SDK, no ad network, and no tracking of any
kind.

## Children's privacy

OpenFlow Mobile is not directed at children and does not knowingly collect data from children,
because it does not collect data from anyone — see above.

## Changes to this policy

If OpenFlow Mobile's data handling ever changes (for example, if a future version adds an
optional cloud sync feature), this page will be updated first and the "Last updated" date above
will change accordingly.

## Contact

Questions or concerns: **[hello@openflow.computer](mailto:hello@openflow.computer)**.
