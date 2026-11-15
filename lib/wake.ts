export interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((e: {
        results: { isFinal: boolean; 0: { transcript: string } }[];
        resultIndex: number;
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  }
}
/** One-shot recognition works with Safari's prefixed API. Start from a click. */
export class WakeListener {
  private active = false;
  private paused = false;
  private disposed = false;
  private triggered = false;
  private timer?: ReturnType<typeof setTimeout>;
  private waiters: (() => void)[] = [];
  constructor(
    private rec: Recognition,
    private onWake: () => void,
    private onError: (message: string) => void,
  ) {
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      if (this.paused || this.disposed || this.triggered) return;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (
          e.results[i].isFinal &&
          /\b(?:hey\s+)?jarvis\b/i.test(e.results[i][0].transcript)
        ) {
          this.triggered = true;
          rec.abort(); // Wait for onend before another microphone consumer starts.
          break;
        }
      }
    };
    rec.onend = () => {
      this.active = false;
      this.waiters.splice(0).forEach((resolve) => resolve());
      if (this.disposed || this.paused) return;
      if (this.triggered) {
        this.triggered = false;
        this.paused = true;
        this.onWake();
      } else this.timer = setTimeout(() => this.start(), 600);
    };
    rec.onerror = (e) => {
      if (this.disposed || ["aborted", "no-speech"].includes(e.error)) return;
      this.dispose();
      this.onError(
        "Wake listening stopped. In Safari, enable Siri or Dictation in macOS settings and allow this site’s microphone, then enable wake mode again. Keep this tab visible. (" +
          e.error +
          ")",
      );
    };
  }
  start() {
    if (this.disposed || this.active) return;
    clearTimeout(this.timer);
    this.paused = false;
    try {
      this.rec.start();
      this.active = true;
    } catch {
      this.dispose();
      this.onError(
        "Could not start wake listening. Click enable again and check microphone permissions.",
      );
    }
  }
  async pause() {
    this.paused = true;
    this.triggered = false;
    clearTimeout(this.timer);
    if (!this.active) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            "Microphone did not release. Disable wake mode and try again.",
          ),
        );
        this.dispose();
        this.onError(
          "Microphone did not release. Enable wake mode again after checking microphone access.",
        );
      }, 3000);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
      this.rec.abort();
    });
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.rec.onresult = this.rec.onerror = this.rec.onend = null;
    this.rec.abort();
    this.active = false;
    this.waiters.splice(0).forEach((resolve) => resolve());
  }
}
