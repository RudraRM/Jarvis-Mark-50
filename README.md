# Jarvis · Mark V

A localhost Next.js dashboard with a Three.js arc reactor, a black star field, NVIDIA-powered answers and speech, wake-word activation, and a persistent text chat fallback.

## Run locally

Requires Node.js 20.9+. Microphone capture works on localhost or HTTPS.

```sh
npm ci
cp .env.example .env.local
# Set NVIDIA_API_KEY in .env.local.
npm run dev
```

Open http://localhost:3000. For production: `npm run build && npm start`.
The server binds to loopback by default. This is a personal local app, not an authenticated public service; add authentication and rate limiting before exposing it to the Internet.

## Talking to Jarvis

- Click the central microphone and allow access. Speak your question; 1.3 seconds of silence finishes the recording. Recording stops after 20 seconds, or 7 seconds without speech.
- Enable the wake-word button to listen for **Jarvis** or **Hey Jarvis**. Say the wake phrase, pause until **I’m listening**, then speak the question. Browser speech recognition detects the wake phrase; the question itself is transcribed by NVIDIA Parakeet. Wake mode is opt-in, supports the prefixed Safari recognition API as well as Chrome/Edge, and may send audio to the browser vendor’s recognition service. It is not an offline keyword detector.
- NVIDIA NIM produces the answer, then NVIDIA Magpie synthesizes its default configured voice (Aria). The reactor pulses during processing and playback. Audio playback may require another user gesture on some browsers.
- Text chat always works independently of microphone support. Speech failures leave the answer visible. Disable spoken answers with the speaker button. Cancel an active request with the central button.
- Bottom-left full-screen control toggles the browser Fullscreen API. On mobile it appears in the compact top navigation.

## Models and configuration

All credentials stay on the server. `.env.local` is ignored by Git; never use `NEXT_PUBLIC_` for an API key.

| Variable | Default |
| --- | --- |
| `NVIDIA_API_KEY` | Required NVIDIA API Catalog key |
| `NVIDIA_CHAT_MODEL` | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| `NVIDIA_TTS_VOICE` | `Magpie-Multilingual.EN-US.Aria` |

NVIDIA models require account access and available quota. Model availability and endpoints can change. Reference: [Parakeet API](https://build.nvidia.com/nvidia/parakeet-ctc-1_1b-asr/api), [Magpie API](https://build.nvidia.com/nvidia/magpie-tts-multilingual/api).

The UI calls Next.js routes. Chat uses NVIDIA’s OpenAI-compatible HTTP endpoint; TTS uses Magpie’s multipart HTTP endpoint. ASR sends mono 16 kHz PCM WAV to NVIDIA Parakeet CTC 1.1B’s multipart HTTP endpoint. No recordings or conversation history are persisted. Wake detection pauses while Jarvis processes or speaks to avoid feedback.

**Latency:** a 10 ms end-to-end voice response is not achievable over these hosted services. Speech duration, silence detection, network travel, model inference, and synthesis all add latency. “Last answer” measures the chat request only, not the full voice round trip. Timeouts and cancellation prevent indefinitely blocked controls. The app allows 180 seconds and up to 8,192 output tokens for answer generation. It waits for the complete answer, then synthesizes ordered chunks of at most 1,200 characters (120 seconds per synthesis request). Each audio chunk plays until it ends; there is no fixed playback cutoff. Cancel stops the sequence. Model-limit truncation is shown explicitly; ask Jarvis to continue. This is not streaming generation and has no latency SLA.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

Validation tests cover role restrictions, input limits, and origin protection. Live NVIDIA access and microphone permissions must also be checked in your own browser. A lost/expired key produces a visible error rather than a fabricated answer.

## Safari wake-word setup and verification

Use current macOS Safari (16.4+), open localhost, allow microphone access in Safari’s website settings, and enable Siri/Dictation in macOS if recognition is unavailable. Click the wake-word button once; this starts recognition and unlocks audio directly from the gesture. Say “Hey Jarvis”, wait for “I’m listening”, then ask your question. The app waits for recognition to release the microphone before recording. Wake listening uses short sessions that restart after silence, pauses during answers, and pauses while the tab is hidden. Keep the tab foregrounded for hands-free use. An embedded WebKit browser may not expose Apple's speech recognition service even if Safari does.

Manual acceptance on a Mac: enable wake mode, try both wake phrases, ask two successive questions, verify that Jarvis does not wake itself during speech, hide/restore the tab, deny/re-enable microphone permission, request a long answer, and cancel it mid-playback. Automated recognition tests use a simulated prefixed API; they cannot certify Apple's speech service or physical microphone permissions. Actual macOS Safari voice verification requires a Mac.

Verification for this update: production build and 10 unit tests passed. Linux WebKit browser checks passed for gesture-initiated startup with a simulated `webkitSpeechRecognition`, permission-error recovery, long-text rendering, and all seven ordered audio chunks using test WAV responses. Chromium also passed the prefixed-API and long-text checks. These do not constitute a live macOS Safari microphone/Siri test.

## Iron Man model

The center stage uses the supplied **Iron Man mark 50** model by [Tsm](https://sketchfab.com/silwalkrishnaa9), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), from [Sketchfab](https://sketchfab.com/3d-models/iron-man-mark-50-14b72606d50840d7a4125128e73386a6). The original GLB is bundled at `public/models/iron-man-mark-50.glb` unchanged. The scene fits a scaled reactor into its chest aperture and adds voice-reactive emissive lighting; see [asset attribution](public/models/ATTRIBUTION.md). The glow follows microphone and spoken-audio volume. Reduced-motion preferences suppress animated motion and pulsing. If WebGL or model loading fails, voice and text chat remain available.
