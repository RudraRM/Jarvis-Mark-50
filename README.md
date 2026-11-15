# 🤖 Jarvis · Mark 50

Your personal AI command center, powered by NVIDIA. Talk to Jarvis, explore ideas, and watch the Iron Man Mark 50 suit’s chest reactor respond to your voice. **Mark 50 = Mark L** in Roman numerals.

## ✨ What Jarvis can do

- 💬 **Answer questions:** explain concepts, brainstorm ideas, help write text, discuss code, and make plans through NVIDIA’s language model.
- 🎙️ **Take spoken questions:** record from your microphone and transcribe with NVIDIA Parakeet.
- 👋 **Wake to your voice:** enable wake mode, say **“Jarvis”** or **“Hey Jarvis,”** pause for **“I’m listening,”** then ask your question.
- 🔊 **Speak answers:** NVIDIA Magpie reads responses using the configured voice, Aria by default. Long responses are split into ordered speech chunks with no application-imposed synthesis or playback time limit. You can cancel at any time.
- 🔁 **Listen for follow-ups:** after a successfully delivered answer ending in a question, Jarvis opens the voice controls and listens for your reply automatically. Silence or cancellation stops the flow.
- ⌨️ **Keep chatting without a microphone:** text chat works independently of voice support. Answers remain visible if speech fails.
- 🦾 **Bring Mark 50 to life:** a full-height 3D suit with a fitted arc reactor that brightens and darkens with microphone and spoken-audio volume.
- 🖥️ **Customize the dashboard:** show or hide the greeting and voice panel from the top-right button, toggle the conversation panel, mute spoken answers, start a fresh conversation, or enter full screen.
- 🛟 **Recover from graphics failures:** a suit preview stays visible if live 3D fails, with a manual reload button and error details. Text and voice controls remain available.

Jarvis answers from the conversation and model knowledge. Live web browsing, computer control, reminders, and external account actions are not connected. Conversation history is kept in memory for the current page session; recordings are not saved by the app. AI answers can be wrong—verify important information.

## 🚀 Run locally

Requires **Node.js 20.9+**, an NVIDIA API Catalog key, and model access/quota. Microphone features require localhost or HTTPS.

```sh
npm ci
```

Create or edit `.env.local` in the project root:

```dotenv
NVIDIA_API_KEY=your_nvidia_api_key
NVIDIA_CHAT_MODEL=z-ai/glm-5.3-flash
NVIDIA_TTS_VOICE=Magpie-Multilingual.EN-US.Aria
```

Keep your real key private and out of Git. Credentials are read by server routes; never prefix the key with `NEXT_PUBLIC_`.

```sh
npm run dev
```

Open [localhost:3000](http://localhost:3000). To run a production build:

```sh
npm run build
npm start
```

The server binds to loopback by default. Add authentication and rate limiting before exposing this personal app publicly.

## 🎧 Using voice

1. Click **Show voice controls** at the top right.
2. Click the microphone, allow access, and speak. A 1.3-second pause ends the question; recordings stop after 20 seconds, or after 7 seconds without speech.
3. For hands-free activation, enable the wake-word button. Say the wake phrase, wait for the listening prompt, then ask your question.
4. The speaker button toggles spoken answers. The central cancel button stops an active request, playback, or follow-up recording.

Wake recognition pauses during processing and playback to avoid hearing Jarvis’s own answer. Keep the tab visible. Enabling wake mode is opt-in and uses the browser’s speech-recognition service, which may send audio to its vendor; questions are transcribed by NVIDIA.

## 🍎 Safari support

Use current macOS Safari, allow microphone access in its website settings, and enable Siri/Dictation in macOS if recognition is unavailable. Click to enable wake mode so Safari can authorize recognition and audio playback. Embedded WebKit browsers may not expose Apple’s speech service.

The 3D viewer uses native image decoding and a reduced rendering resolution for compatibility. If Safari cannot create WebGL 2, loses its graphics context, or fails to load the model, the dashboard shows a preview and a specific error. **Reload Mark 50** retries manually without an automatic recovery loop.

WebKit checks cover model rendering, texture decoding, fallback/retry behavior, and simulated wake recognition. A live Mac microphone/Siri check still depends on your device and permissions.

## ⚡ Models and response timing

| Stage | Service |
| --- | --- |
| Speech to text | NVIDIA Parakeet CTC 1.1B |
| Answer generation | GLM-5.3-Flash on NVIDIA, configurable through `NVIDIA_CHAT_MODEL` |
| Text to speech | NVIDIA Magpie Multilingual, configurable through `NVIDIA_TTS_VOICE` |
| Visualization | Three.js + the supplied Mark 50 GLB |

Answer generation allows up to **180 seconds** and **8,192 output tokens**. Speech uses chunks of at most **1,200 characters**, each played to completion. NVIDIA and network limits can still interrupt requests; errors include the failure cause. If an answer hits the model output limit, ask Jarvis to continue.

“Last answer” measures the chat request, not the full voice round trip. Hosted inference cannot provide a 10 ms end-to-end speech response. The app waits for the complete text answer before speech synthesis.

API references: [Parakeet](https://build.nvidia.com/nvidia/parakeet-ctc-1_1b-asr/api) · [Magpie](https://build.nvidia.com/nvidia/magpie-tts-multilingual/api).

## 🧪 Development checks

```sh
npm test
npm run typecheck
npm run build
```

Tests cover conversation validation, origin checks, wake-listener handoff and recovery, long speech chunk ordering, playback cancellation, and audio-level reporting. Browser checks supplement these tests; physical microphone permissions and NVIDIA account access require local verification.

## 🎨 Model credits

**Iron Man mark 50** by [Tsm](https://sketchfab.com/silwalkrishnaa9), from [Sketchfab](https://sketchfab.com/3d-models/iron-man-mark-50-14b72606d50840d7a4125128e73386a6), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The supplied GLB is bundled unchanged. Runtime additions include scene lighting, normalized framing, a fitted reactor, and a chest-emission mask. The preview image is rendered from the same model. See [full asset attribution](public/models/ATTRIBUTION.md).

### ⚡ Fast chat configuration

Chat defaults to `z-ai/glm-5.3-flash`. It uses NVIDIA’s documented `reasoning_effort: "low"` and `clear_thinking: true` settings, with short conversational answers by default. Requests explicitly asking for detail or research retain a larger output budget. This reduces generation work but does not guarantee endpoint latency; the app still waits for the complete answer before speech. Web search and tool execution are not connected, so this setting alone does not enable live research.

### 🔎 Live model verification

With Jarvis running locally, test the real configured endpoint (not a mocked response):

```sh
node scripts/test-live-chat.mjs
```

The check asks a simple arithmetic question, verifies the expected answer, reports elapsed time, and exits with a failure status for errors or an incorrect answer. It does not print API credentials.

**November 15, 2026 verification:** GLM-5.3-Flash with low reasoning effort did not return an answer: a direct NVIDIA request timed out after 180.14 seconds, and the Jarvis chat route returned a timeout after 180.74 seconds. A control request using the same key and network with Nemotron 3.5 Lightning returned HTTP 200 and the correct answer in 1.46 seconds. All 11 automated tests passed, but GLM live inference and fast responses remain unverified. GLM stays selected; these results do not establish the endpoint's behavior for other accounts or networks.
