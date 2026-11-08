# Capture pipeline (voice + text)

```
mic ─► MediaRecorder (format picked at runtime) ─► POST /api/capture (audio)
                                                        │
text ─────────────────────────────────────────► POST /api/capture (text)
                                                        ▼
                                  STT provider (voice only) → transcript
                                                        ▼
                         deterministic parser (lib/parse)  +  LLM extractor (structured output)
                                                        ▼
                           Zod schema → reconcile → flags → candidates[]  (nothing saved yet)
                                                        ▼
                         review UI → user confirms/fixes → record_transactions RPC
```

## Recording (browser) — implemented

- Web Audio, not MediaRecorder: `public/pcm-worklet.js` (AudioWorklet) → `lib/recorder.ts` → `lib/wav.ts` = 16 kHz mono 16-bit WAV. Reason: MediaRecorder gives WebM (Chrome) / MP4 (Safari) and Gemini doesn't document WebM; WAV works on every browser. Cost ~32 KB/s (≈1 MB per 30 s) — switch to Opus if 3G upload time shows up in metrics.
- States: consent (first use) → asking for mic → listening (live level waveform, timer, 30 s cap) → understanding → review → saved. Errors each have their own screen + "Type instead": denied, no mic, mic busy, interrupted, unsupported, insecure (non-https), offline, didn't catch that, service busy.
- Silence (< 0.6 s or peak < 0.01) is rejected locally — no API call. App backgrounded mid-recording → stop and keep the clip.

## Speech-to-text — Gemini (implemented, `lib/stt.ts`, `/api/voice`)

Config: `STT_MODEL=gemini-3-flash-preview:minimal`, `STT_FALLBACK_MODELS=gemini-flash-latest` (`model:thinkingLevel`, per model — gemini-flash-latest rejects `minimal` with 400).
- **Hedged requests:** if the primary hasn't answered in 4 s, the fallback starts in parallel; first answer wins, the other is aborted. Each call has a 12 s timeout (one `gemini-flash-latest` call once hung 288 s).
- **Thinking off (`minimal`):** 1.9–2.6 s vs 5.6–10 s with default thinking, same accuracy on our clips, 0 thought tokens.
- **Excluded: flash-lite models.** In testing `gemini-3.1-flash-lite` heard ៣០០ for ១០០ — a confident wrong amount no parser can catch.
- Transcript → the **same** `parseCapture` / `needsAI` / `extractWithAI` path as typed text; voice uses `resolveAccounts(…, allowDefault=false)`. Nothing is auto-saved; the amount is shown large for confirmation.
- Audio and transcripts are never stored or logged. `capture_metrics` keeps only timings, model name, outcome, item count.

Measured on synthetic Khmer clips (Gemini TTS), not real phone audio — the real benchmark (≥ 60 clips, 5+ speakers, street noise) is still to do:

| Setup | Server time | Result |
|---|---|---|
| default thinking | 3.5–17.7 s | correct |
| `minimal` + hedge (current) | 1.8–2.6 s (total 1.9–2.9 s) | 4/4 correct |

## Chirp 3 streaming (built, waiting for credentials)

Browser ⇄ WebSocket ⇄ relay ⇄ Chirp 3 `StreamingRecognize` (gRPC, `chirp_3`, `km-KH` — **Preview**, region `us`).
- `lib/chirp-relay.ts` — host-agnostic relay + protocol (start/token → PCM16 frames ≤ 25 KB → end; ready/partial/final/error). Auth = Supabase access token verified with `getClaims`; 30 s cap; 10 s final timeout keeps what was heard.
- `lib/chirp.ts` — real deps: `v2.SpeechClient` (`us-speech.googleapis.com`), credentials from `GOOGLE_SERVICE_ACCOUNT_JSON`; final transcript → the same `parseCapture`/`needsAI`/`extractWithAI` as everything else.
- Hosts: Vercel `GET /api/voice/stream` (`upgradeWebSocket`, Vercel runtime only) and `npm run stt-relay` (plain `ws`, for dev — Next dev can't upgrade).
- Browser: `lib/stream-client.ts` streams the recorder's live 16 kHz PCM; partial text shows while speaking. **Any failure → the same clip goes to the Gemini route**, so voice never depends on Chirp. Verified: relay `unconfigured` → automatic Gemini fallback → correct review in 2.9 s.
- Chirp rejects API keys (tested: 401). **Live result (2026-11-08, synthetic clips): 2/2 exact transcripts, final 0.86–0.87 s after end of audio; Chirp sent one partial only at the end — no live words while speaking.**

## Reconciliation rules (deterministic, override the LLM)

- Amount: the deterministic Khmer-number parser runs on the transcript. If it finds an amount and the LLM's differs → `flag: amount`, show both.
- Multipliers: ពាន់ ×1,000 · ម៉ឺន ×10,000 · សែន ×100,000 · លាន ×1,000,000 · `k` ×1,000. "៥ ម៉ឺន" = 50,000 ៛. "២ម៉ឺន៥" = 25,000 ៛.
- កន្លះ (half): after a magnitude adds half the unit ("២ម៉ឺនកន្លះ" = 25,000 ៛); after a dollar cue adds 50¢ ("ពីរដុល្លារកន្លះ" = $2.50).
- Currency: only from explicit words/symbols (ដុល្លារ, $, រៀល, ៛, k/ពាន់/ម៉ឺន imply riel). Otherwise `flag: currency` with both options.
- Account: matched to the user's own accounts by kind/name. 0 matches → `flag: account` (do not silently use the default for voice). >1 match (e.g. ABA USD + ABA KHR) → pick the one whose currency matches, else flag.
- Transfer without source or destination, or same account → flag.
- Invalid/unparseable LLM output → fall back to deterministic parse; if that's empty → "Didn't catch that".
- Model "confidence" is logged, never used to skip confirmation.
- Unflagged voice items still require one tap to save (no countdown auto-save in MVP; revisit with benchmark data).

## Hybrid text parser (implemented)

Code: `lib/parse.ts` (deterministic + `needsAI`), `lib/extract.ts` (server-only model call + `reconcile`), `app/api/capture/route.ts`, `lib/capture.ts` (`parseHybrid`, client).

- **Deterministic first, always.** Handles digits, Khmer digits, Khmer number words (មួយ…ប្រាំបួន, ដប់…កៅសិប, រយ, combined with ពាន់/ម៉ឺន/សែន/លាន, e.g. ប្រាំម៉ឺន = 50,000 ៛, ប្រាំដុល្លារ = $5), currencies, account names, type and category. A lone 1–9 word counts as a number only next to a magnitude/currency word ("មួយកែវ" = one cup stays text).
- **AI only when `needsAI`:** the text has amount readings AND (there are more readings than priced items — the splitter couldn't separate them — or an item is flagged `amount`). No number in the text → never AI (it may not invent one). A bare small number (currency question) → not AI: the model can't know the currency either. Text and voice use the same path; the client skips the network entirely when `needsAI` is false.
- **Model config:** `EXTRACT_PROVIDER` = `gemini` (default when no Anthropic key: REST, `gemini-3-flash-preview:minimal`, reuses `STT_API_KEY`, JSON schema output) or `anthropic` (SDK, `claude-haiku-5-5`, `effort: low`). `EXTRACT_MODEL`/`EXTRACT_API_KEY` override. 4 s timeout, no retries. Live check 2026-11-08, 25 hard entries: Gemini p50 ≈ 1.0 s, max 1.5 s; the parser now places 19 itself and sends 6 to AI, all 6 split and priced right. A priced reading (៣ពាន់) wins over a bare quantity (៣ ដប). No key / error / timeout / refusal / bad JSON → deterministic result, `usedAI: false`. Input text, amounts and model output are never logged. The model is not asked for a confidence score.
- **Reconcile (`lib/extract.ts`):** Zod-validate (type + amount must be valid; off-list category → `other`, off-list currency/account → null). Each AI amount must equal an unused reading the deterministic parser found in the text (explicit hit in its own currency; bare number as written or ×1,000 riel), else `amount = null` + `flag: amount`. Currency comes from the text's cue, never the model; bare numbers follow the deterministic rule (≥ 1,000 → riel, marked assumed; smaller → `flag: currency` + options), and a model "USD" on a cue-less number → `flag: currency` with both readings. Account hints only from {aba, acleda, wing, cash} and only if named in the text. Transfer to the same account → `flag: same`. If the model drops a priced item, or places no amount, the whole AI result is discarded for the deterministic one.
- Endpoint: `POST /api/capture {text ≤ 500, mode, source}` → `{candidates, usedAI}`; requires a Supabase session (401), 20 req/min/user in-memory per instance (429).

## Latency instrumentation

`capture_jobs` stores ms for recording, upload, STT, extraction, and save. Dashboard query only; no third-party analytics in MVP.
