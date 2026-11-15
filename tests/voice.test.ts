import { test } from "node:test";
import assert from "node:assert/strict";
import { WakeListener, type Recognition } from "../lib/wake";
import { speechChunks } from "../lib/speech";
import { validateMessages } from "../lib/server";
class FakeRecognition implements Recognition {
  continuous = true;
  interimResults = true;
  lang = "";
  onresult: Recognition["onresult"] = null;
  onerror: Recognition["onerror"] = null;
  onend: Recognition["onend"] = null;
  starts = 0;
  aborts = 0;
  start() {
    this.starts++;
  }
  abort() {
    this.aborts++;
  }
  phrase(text: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: text } }],
    });
  }
}
test("Safari one-shot wake starts synchronously and hands off only after microphone release", () => {
  const rec = new FakeRecognition();
  let wakes = 0;
  const listener = new WakeListener(rec, () => wakes++, assert.fail);
  listener.start();
  assert.equal(rec.starts, 1);
  assert.equal(rec.continuous, false);
  rec.phrase("Hey Jarvis");
  rec.phrase("Jarvis");
  assert.equal(wakes, 0);
  assert.equal(rec.aborts, 1);
  rec.onend?.();
  assert.equal(wakes, 1);
  listener.dispose();
});
test("pause waits for end, ignores wake during answers, and resumes once", async () => {
  const rec = new FakeRecognition();
  const listener = new WakeListener(
    rec,
    () => assert.fail("unexpected wake"),
    assert.fail,
  );
  listener.start();
  let released = false;
  const pause = listener.pause().then(() => {
    released = true;
  });
  await Promise.resolve();
  assert.equal(released, false);
  rec.phrase("Jarvis");
  rec.onend?.();
  await pause;
  assert.equal(released, true);
  listener.start();
  listener.start();
  assert.equal(rec.starts, 2);
  listener.dispose();
});
test("permission errors stop recognition and show recovery instructions", () => {
  const rec = new FakeRecognition();
  let message = "";
  const listener = new WakeListener(rec, assert.fail, (m) => (message = m));
  listener.start();
  rec.onerror?.({ error: "not-allowed" });
  assert.match(message, /Safari/);
  listener.start();
  assert.equal(rec.starts, 1);
  assert.equal(rec.onend, null);
});
test("long speech chunks preserve all text in order and respect synthesis bounds", () => {
  for (const text of [
    "A detailed sentence. ".repeat(1200),
    "x".repeat(9000),
    "Hello world",
  ]) {
    const chunks = speechChunks(text);
    assert.equal(chunks.join(""), text);
    assert.ok(chunks.every((c) => c.length <= 1200 && c.length > 0));
  }
});
test("long assistant replies can be included in follow-up context", () => {
  assert.equal(
    validateMessages([
      { role: "assistant", content: "a".repeat(32000) },
      { role: "user", content: "Continue" },
    ]).length,
    2,
  );
  assert.throws(() =>
    validateMessages([{ role: "user", content: "a".repeat(4001) }]),
  );
});

test("speech playback waits for audio end and cancellation stops it", async () => {
  const { SpeechPlayer } = await import("../lib/speech");
  const sources: {
    onended: null | (() => void);
    stopped: boolean;
    stop(): void;
  }[] = [];
  const original = globalThis.AudioContext;
  class FakeAudioContext {
    state = "running";
    sampleRate = 44100;
    destination = {};
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
    createBuffer() {
      return {};
    }
    decodeAudioData() {
      return Promise.resolve({ duration: 600 });
    }
    createBufferSource() {
      const source = {
        buffer: null,
        onended: null,
        stopped: false,
        connect() {},
        disconnect() {},
        start() {},
        stop() {
          this.stopped = true;
        },
      };
      sources.push(source);
      return source;
    }
  }
  globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  try {
    const player = new SpeechPlayer();
    player.unlock();
    let finished = false;
    const ctrl = new AbortController();
    const playing = player
      .play(new ArrayBuffer(1), ctrl.signal, () => {})
      .then(() => {
        finished = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(finished, false);
    sources.at(-1)!.onended!();
    await playing;
    assert.equal(finished, true);
    const cancelled = player.play(new ArrayBuffer(1), ctrl.signal, () => {});
    await Promise.resolve();
    ctrl.abort();
    await assert.rejects(cancelled, { name: "AbortError" });
    assert.equal(sources.at(-1)!.stopped, true);
  } finally {
    globalThis.AudioContext = original;
  }
});
