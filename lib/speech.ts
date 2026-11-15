/** Preserve every character, preferring sentence/word boundaries for synthesis. */
export function speechChunks(text: string, limit = 1200): string[] {
  if (limit < 1) throw new Error("Chunk size must be positive.");
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    const prefix = remaining.slice(0, limit);
    const sentences = [...prefix.matchAll(/[.!?]\s+/g)];
    const last = sentences.at(-1);
    let cut = last ? last.index! + last[0].length : prefix.lastIndexOf(" ") + 1;
    if (cut < limit / 2) cut = limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
/** Web Audio is unlocked in the user's click, before any network round trip. */
export class SpeechPlayer {
  private context?: AudioContext;
  unlock() {
    this.context ??= new AudioContext();
    void this.context.resume().catch(() => {});
    const source = this.context.createBufferSource();
    source.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
    source.connect(this.context.destination);
    source.start();
  }
  async play(
    data: ArrayBuffer,
    signal: AbortSignal,
    onStart: () => void,
    onLevel?: (level: number) => void,
  ) {
    signal.throwIfAborted();
    const context = this.context;
    if (!context || context.state !== "running")
      throw new Error("Click to enable audio playback.");
    const buffer = await context.decodeAudioData(data);
    signal.throwIfAborted();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    await new Promise<void>((resolve, reject) => {
      let meter: ReturnType<typeof setInterval> | undefined;
      const clean = () => {
        signal.removeEventListener("abort", abort);
        source.disconnect();
        clearInterval(meter);
        onLevel?.(0);
      };
      const abort = () => {
        source.onended = null;
        source.stop();
        clean();
        reject(new DOMException("Aborted", "AbortError"));
      };
      source.onended = () => {
        clean();
        resolve();
      };
      signal.addEventListener("abort", abort, { once: true });
      const started = context.currentTime;
      source.start();
      if (onLevel) {
        const samples = buffer.getChannelData(0);
        meter = setInterval(() => {
          const offset = Math.floor(
            (context.currentTime - started) * buffer.sampleRate,
          );
          const end = Math.min(
            samples.length,
            offset + Math.floor(buffer.sampleRate * 0.03),
          );
          let sum = 0;
          for (let i = offset; i < end; i++) sum += samples[i] * samples[i];
          onLevel(Math.min(1, Math.sqrt(sum / Math.max(1, end - offset)) * 5));
        }, 40);
      }
      onStart();
    });
  }
  dispose() {
    void this.context?.close();
  }
}
