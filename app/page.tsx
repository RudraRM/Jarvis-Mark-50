"use client";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUp,
  AudioLines,
  Command,
  Maximize,
  MessageSquare,
  Mic,
  MicOff,
  Plus,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Reactor from "@/components/Reactor";
import { recordQuestion } from "@/lib/audio";
import type { Message } from "@/lib/server";
interface Recognition {
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
  start: () => void;
  abort: () => void;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  }
}
type Phase = "standby" | "listening" | "transcribing" | "thinking" | "speaking";
const labels: Record<Phase, string> = {
  standby: "At your service.",
  listening: "I’m listening.",
  transcribing: "Processing your voice.",
  thinking: "A moment of thought.",
  speaking: "Here’s what I found.",
};
export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("standby");
  const [error, setError] = useState("");
  const [wake, setWake] = useState(false);
  const [voice, setVoice] = useState(true);
  const [level, setLevel] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const history = useRef<Message[]>([]);
  const voiceRef = useRef(voice);
  const recognition = useRef<Recognition | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const askRef = useRef<() => void>(() => {});
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, phase]);
  useEffect(
    () => () => {
      controller.current?.abort();
      audio.current?.pause();
      recognition.current?.abort();
    },
    [],
  );
  async function api(path: string, body: unknown, signal: AbortSignal) {
    const result = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!result.ok)
      throw new Error((await result.json()).error || "Request failed.");
    return result;
  }
  async function answer(text: string, signal: AbortSignal) {
    const next: Message[] = [
      ...history.current,
      { role: "user", content: text },
    ];
    history.current = next;
    setMessages(next);
    setPhase("thinking");
    const start = performance.now();
    const result = await (
      await api("/api/chat", { messages: next.slice(-24) }, signal)
    ).json();
    setLatency(Math.round(performance.now() - start));
    const updated: Message[] = [
      ...next,
      { role: "assistant", content: result.text },
    ];
    history.current = updated;
    setMessages(updated);
    if (voiceRef.current) {
      try {
        const response = await api("/api/speak", { text: result.text }, signal);
        const url = URL.createObjectURL(await response.blob());
        const player = new Audio(url);
        audio.current = player;
        try {
          signal.throwIfAborted();
          await new Promise<void>((resolve, reject) => {
            const aborted = () => {
              player.pause();
              reject(new DOMException("Aborted", "AbortError"));
            };
            signal.addEventListener("abort", aborted, { once: true });
            const clean = () => signal.removeEventListener("abort", aborted);
            player.onended = () => {
              clean();
              resolve();
            };
            player.onerror = () => {
              clean();
              reject(new Error("Audio playback unavailable."));
            };
            player
              .play()
              .then(() => setPhase("speaking"))
              .catch((e) => {
                clean();
                reject(e);
              });
          });
        } finally {
          player.pause();
          URL.revokeObjectURL(url);
          audio.current = null;
        }
      } catch (e) {
        if (signal.aborted) throw e;
        setError(
          "Voice output is unavailable. Your answer is in the conversation.",
        );
      }
    }
  }
  async function run(text?: string) {
    if (busy.current) return;
    busy.current = true;
    setError("");
    recognition.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    try {
      if (text) {
        await answer(text, ctrl.signal);
      } else {
        setPhase("listening");
        const blob = await recordQuestion(setLevel, ctrl.signal);
        setPhase("transcribing");
        const response = await fetch("/api/transcribe", {
          method: "POST",
          body: blob,
          signal: ctrl.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        const question = data.text
          ?.replace(/^(hey\s+)?jarvis[,.!?]?\s*/i, "")
          .trim();
        if (!question)
          throw new Error(
            "No question detected. Please try again or type below.",
          );
        await answer(question, ctrl.signal);
      }
    } catch (e) {
      if (!ctrl.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Microphone unavailable. Please use chat.",
        );
    } finally {
      busy.current = false;
      setPhase("standby");
      controller.current = null;
    }
  }
  askRef.current = () => {
    void run();
  };
  useEffect(() => {
    if (!wake) return;
    const Constructor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) {
      setError(
        "Wake words are not supported in this browser. Use the microphone button or chat.",
      );
      setWake(false);
      return;
    }
    const rec = new Constructor();
    recognition.current = rec;
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = "en-US";
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (
          e.results[i].isFinal &&
          /\b(?:hey\s+)?jarvis\b/i.test(e.results[i][0].transcript) &&
          !busy.current
        ) {
          rec.abort();
          askRef.current();
          break;
        }
      }
    };
    rec.onerror = (e) => {
      if (
        ["not-allowed", "service-not-allowed", "audio-capture"].includes(
          e.error,
        )
      ) {
        setError(
          "Wake-word microphone access failed. Use chat or allow microphone access.",
        );
        setWake(false);
      }
    };
    const start = () => {
      if (disposed) return;
      if (!busy.current) {
        try {
          rec.start();
        } catch {
          /* Restart after the current session finishes. */
        }
      } else {
        timer = setTimeout(start, 500);
      }
    };
    rec.onend = () => {
      if (!disposed) timer = setTimeout(start, 500);
    };
    start();
    return () => {
      disposed = true;
      clearTimeout(timer);
      rec.onend = null;
      rec.abort();
      recognition.current = null;
    };
  }, [wake]);
  const cancel = () => {
    controller.current?.abort();
    audio.current?.pause();
  };
  const prompts = [
    "Explain something complex",
    "Help me plan my day",
    "Let’s build something",
  ];
  return (
    <main className="dashboard">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Jarvis home">
          <span className="brand-icon">J</span>
          <span>
            Jarvis<small>MARK V</small>
          </span>
        </a>
        <div className="nav-caption">WORKSPACE</div>
        <button className="nav-item selected" onClick={() => setChatOpen(true)}>
          <Command size={18} /> Command center <span className="nav-dot" />
        </button>
        <button className="nav-item" onClick={() => setChatOpen((v) => !v)}>
          <MessageSquare size={18} /> Conversation{" "}
          <span className="count">
            {messages.filter((m) => m.role === "user").length}
          </span>
        </button>
        <div className="sidebar-bottom">
          <div className="powered">
            <span className="chip">N</span>
            <div>
              Powered by NVIDIA<small>Intelligence, accelerated.</small>
            </div>
          </div>
          <button
            className="fullscreen"
            onClick={async () => {
              try {
                if (document.fullscreenElement) await document.exitFullscreen();
                else await document.documentElement.requestFullscreen();
              } catch {
                setError("Fullscreen is unavailable in this browser.");
              }
            }}
          >
            <Maximize size={16} /> Full screen <span>↗</span>
          </button>
          <div className="profile">
            <div className="avatar">R</div>
            <div>
              Personal workspace<small>JARVIS / V.01</small>
            </div>
            <span className="green-dot" />
          </div>
        </div>
      </aside>
      <section className="workspace">
        <header>
          <div className="breadcrumb">
            WORKSPACE <span>/</span> <b>COMMAND CENTER</b>
          </div>
          <div className="system-status">
            <span className="green-dot" /> INTERFACE READY
          </div>
        </header>
        <div className="workspace-body">
          <section className="command-stage">
            <div className="stage-top">
              <span className="eyebrow">PERSONAL INTELLIGENCE INTERFACE</span>
              <span className="version">
                MK. V <span>↗</span>
              </span>
            </div>
            <div className="hero">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <Reactor active={phase !== "standby"} level={level} />
              <div className="reactor-label">
                <span className="tiny-cross">+</span> ARC REACTOR{" "}
                <span className="muted">/ 01</span>
              </div>
              <div className="reactor-coordinate">
                CORE SYSTEM
                <br />
                <span>NEURAL INTERFACE</span>
              </div>
              <div className="hero-copy">
                <div className="online-tag">
                  <span />{" "}
                  {phase === "standby" ? "JARVIS ONLINE" : phase.toUpperCase()}
                </div>
                <h1>{labels[phase]}</h1>
                <p>
                  {phase === "listening"
                    ? "Speak your question. I’ll stop when you pause."
                    : wake
                      ? "Say “Hey Jarvis,” pause, then ask your question."
                      : "A little curiosity. Infinite possibilities."}
                </p>
              </div>
            </div>
            <div className="interaction">
              <div className="voice-controls">
                <button
                  title={
                    voice ? "Mute spoken answers" : "Enable spoken answers"
                  }
                  className={"round secondary " + (!voice ? "off" : "")}
                  onClick={() => {
                    setVoice(!voice);
                    if (voice) cancel();
                  }}
                >
                  {voice ? <Volume2 size={19} /> : <VolumeX size={19} />}
                </button>
                <button
                  className={
                    "mic-button " + (phase !== "standby" ? "active" : "")
                  }
                  onClick={() => (busy.current ? cancel() : void run())}
                  aria-label={
                    phase === "standby"
                      ? "Ask with microphone"
                      : "Cancel current request"
                  }
                >
                  {phase === "standby" ? <Mic size={24} /> : <X size={24} />}
                </button>
                <button
                  title="Toggle wake-word listening"
                  className={"round secondary " + (wake ? "enabled" : "")}
                  onClick={() => setWake(!wake)}
                >
                  {wake ? <AudioLines size={20} /> : <MicOff size={19} />}
                </button>
              </div>
              <div className="mic-hint">
                {phase === "standby" ? "CLICK TO SPEAK" : "CLICK TO CANCEL"}{" "}
                <span>·</span> {wake ? "WAKE WORD ON" : "WAKE WORD OFF"}
              </div>
              <p className="privacy-note">
                Wake mode uses browser speech recognition. Questions go to
                NVIDIA.
              </p>
            </div>
            <div className="suggestions">
              <div className="suggestion-label">A place to start</div>
              <div className="prompt-grid">
                {prompts.map((p, i) => (
                  <button
                    key={p}
                    disabled={phase !== "standby"}
                    onClick={() => void run(p)}
                  >
                    <span className="prompt-number">0{i + 1}</span>
                    {p}
                    <span>↗</span>
                  </button>
                ))}
              </div>
            </div>
            <footer className="telemetry">
              <div>
                <Activity size={14} />
                <span>SYSTEM</span>
                <b>Operational</b>
              </div>
              <div>
                <span>MODEL</span>
                <b>NVIDIA NIM</b>
              </div>
              <div>
                <span>LAST ANSWER</span>
                <b>
                  {latency === null ? "—" : `${(latency / 1000).toFixed(2)} s`}
                </b>
              </div>
              <span className="footer-mark">J.A.R.V.I.S.</span>
            </footer>
          </section>
          {chatOpen ? (
            <aside className="chat">
              <div className="chat-heading">
                <div>
                  <MessageSquare size={17} />
                  <h2>Conversation</h2>
                </div>
                <button
                  title="New conversation"
                  disabled={phase !== "standby"}
                  onClick={() => {
                    history.current = [];
                    setMessages([]);
                    setError("");
                    setLatency(null);
                  }}
                >
                  <Plus size={19} />
                </button>
              </div>
              <div className="chat-subheading">
                A direct line to your intelligence.
              </div>
              <div className="messages" aria-live="polite">
                {messages.length === 0 ? (
                  <div className="welcome">
                    <div className="assistant-icon">✧</div>
                    <div className="message-author">
                      JARVIS <span>READY WHEN YOU ARE</span>
                    </div>
                    <p>
                      Good to see you.
                      <br />
                      What’s on your mind?
                    </p>
                    <p className="welcome-detail">
                      Ask a question, explore an idea, or let’s make a plan. I’m
                      here to help.
                    </p>
                    <span className="welcome-line" />
                  </div>
                ) : (
                  messages.map((m, i) => (
                    <div className={"message " + m.role} key={i}>
                      <div className="message-author">
                        {m.role === "user" ? "YOU" : "JARVIS"}
                      </div>
                      <p>{m.content}</p>
                    </div>
                  ))
                )}
                {phase === "thinking" && (
                  <div className="thinking">
                    Jarvis is thinking<span>•••</span>
                  </div>
                )}
                <div ref={bottom} />
              </div>
              <div className="chat-compose">
                {error && (
                  <div role="alert" className="error">
                    {error}
                    <button
                      onClick={() => setError("")}
                      aria-label="Dismiss error"
                    >
                      ×
                    </button>
                  </div>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (input.trim() && !busy.current) {
                      void run(input.trim());
                      setInput("");
                    }
                  }}
                >
                  <label className="sr-only" htmlFor="question">
                    Message Jarvis
                  </label>
                  <textarea
                    id="question"
                    placeholder="Ask Jarvis anything…"
                    value={input}
                    maxLength={4000}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <div className="compose-bottom">
                    <span>
                      ↵ <span>to send</span>
                    </span>
                    <button
                      aria-label="Send message"
                      disabled={!input.trim() || phase !== "standby"}
                    >
                      <ArrowUp size={17} />
                    </button>
                  </div>
                </form>
                <p>AI can make mistakes. Stay curious. Verify.</p>
              </div>
            </aside>
          ) : (
            <button className="reopen-chat" onClick={() => setChatOpen(true)}>
              <MessageSquare size={18} /> Open chat
            </button>
          )}
        </div>
        {!chatOpen && error && (
          <div className="floating-error" role="alert">
            {error}
          </div>
        )}
      </section>
    </main>
  );
}
