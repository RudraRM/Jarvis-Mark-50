export async function recordQuestion(
  onLevel: (level: number) => void,
  signal: AbortSignal,
  onSpeechStart?: () => void,
): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    if (signal.aborted) throw new Error("Recording cancelled.");
    await context.audioWorklet.addModule("/capture.js");
    await context.resume();
    signal.throwIfAborted();
    const source = context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(context, "capture");
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(capture);
    capture.connect(mute);
    mute.connect(context.destination);
    const chunks: Float32Array[] = [];
    await new Promise<void>((resolve, reject) => {
      const start = performance.now();
      let lastSound = start;
      let heard = false;
      const cleanup = () => {
        capture.port.onmessage = null;
        clearInterval(timer);
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        reject(new Error("Recording cancelled."));
      };
      signal.addEventListener("abort", abort, { once: true });
      capture.port.onmessage = (event) => {
        const samples = event.data as Float32Array;
        chunks.push(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, n) => sum + n * n, 0) / samples.length,
        );
        onLevel(Math.min(1, rms * 8));
        if (rms > 0.015) {
          lastSound = performance.now();
          if (!heard) onSpeechStart?.();
          heard = true;
        }
      };
      const timer = setInterval(() => {
        const now = performance.now();
        if (
          now - start > 20000 ||
          (heard && now - lastSound > 800) ||
          (!heard && now - start > 7000)
        ) {
          cleanup();
          if (!heard) reject(new Error("No speech detected. Click the microphone when you’re ready to reply."));
          else resolve();
        }
      }, 100);
    });
    const sourceSamples = new Float32Array(
      chunks.reduce((sum, c) => sum + c.length, 0),
    );
    let offset = 0;
    for (const chunk of chunks) {
      sourceSamples.set(chunk, offset);
      offset += chunk.length;
    }
    const count = Math.floor(
      (sourceSamples.length * 16000) / context.sampleRate,
    );
    const buffer = new ArrayBuffer(44 + count * 2);
    const view = new DataView(buffer);
    const str = (offset: number, text: string) => {
      for (let i = 0; i < text.length; i++)
        view.setUint8(offset + i, text.charCodeAt(i));
    };
    str(0, "RIFF");
    view.setUint32(4, 36 + count * 2, true);
    str(8, "WAVE");
    str(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    str(36, "data");
    view.setUint32(40, count * 2, true);
    for (let i = 0; i < count; i++)
      view.setInt16(
        44 + i * 2,
        Math.max(
          -1,
          Math.min(
            1,
            sourceSamples[Math.floor((i * context.sampleRate) / 16000)],
          ),
        ) * 32767,
        true,
      );
    return new Blob([buffer], { type: "audio/wav" });
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    await context.close();
    onLevel(0);
  }
}
