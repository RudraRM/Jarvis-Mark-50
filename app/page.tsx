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
import { readChatStream } from "@/lib/chat-stream";
import { recordQuestion } from "@/lib/audio";
import type { Message } from "@/lib/server";
import { WakeListener } from "@/lib/wake";
import { SpeechPlayer, speechChunks } from "@/lib/speech";
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
  const [showControls, setShowControls] = useState(false);
  const [wake, setWake] = useState(false);
  const [voice, setVoice] = useState(true);
  const [eyesLit, setEyesLit] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const speech = useRef<SpeechPlayer | null>(null);
  const history = useRef<Message[]>([]);
  const voiceRef = useRef(voice);
  const recognition = useRef<WakeListener | null>(null);
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

      recognition.current?.dispose();
      speech.current?.dispose();
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
    const recent = next.slice(-24);
    // Keep long-answer follow-ups within the server request budget.
    while (
      recent.length > 1 &&
      new TextEncoder().encode(JSON.stringify({ messages: recent })).length >
        110000
    )
      recent.shift();
    let fullText = "";
    let speechBuffer = "";
    let speechFailed = false;
    let speechQueue = Promise.resolve();
    const wantsVoice = voiceRef.current;
    const enqueue = (text: string) => {
      if (!wantsVoice || !text.trim()) return;
      speechQueue = speechQueue.then(async () => {
        if (speechFailed) return;
        signal.throwIfAborted();
        try {
          for (const chunk of speechChunks(text)) {
            const response = await api('/api/speak', {text:chunk}, signal);
            await speech.current!.play(await response.arrayBuffer(), signal, () => setPhase('speaking'), () => {});
          }
        } catch (error) {
          speechFailed = true;
          if (!signal.aborted) {
            setError(`Speech could not finish: ${error instanceof Error ? error.message : 'Audio service failed'}. Your answer remains in chat.`);
            setShowControls(true);
          }
        }
      }).catch(() => {speechFailed = true;});
    };
    try {
      const response = await api('/api/chat', {messages:recent, stream:true}, signal);
      let first = true;
      const result = await readChatStream(response, delta => {
        if (first) {setLatency(Math.round(performance.now()-start));first=false;}
        fullText += delta;
        setMessages([...next, {role:'assistant',content:fullText}]);
        speechBuffer += delta;
        // Start synthesis at a sentence boundary, before generation completes.
        let match;
        while ((match = /[.!?](?:["”’)]*)\s/.exec(speechBuffer))) {
          const cut = match.index + match[0].length;
          enqueue(speechBuffer.slice(0,cut));speechBuffer=speechBuffer.slice(cut);
        }
        if (speechBuffer.length > 1200) {
          const cut = speechBuffer.lastIndexOf(' ',1200);
          enqueue(speechBuffer.slice(0,cut>0?cut:1200));speechBuffer=speechBuffer.slice(cut>0?cut:1200);
        }
      });
      if (!fullText.trim()) throw new Error('NVIDIA returned an empty answer. Please try again.');
      history.current = [...next,{role:'assistant',content:fullText}];
      enqueue(speechBuffer);
      if(result.truncated)setError('The answer reached the model’s output limit. Ask Jarvis to continue.');
      await speechQueue;
      signal.throwIfAborted();
      return !speechFailed && /[?？]$/.test(fullText.trim().replace(/["”’\x27)*\]]+$/, '').trim());
    } catch (error) {
      speechFailed = true;
      await speechQueue;
      if(fullText) history.current = [...next,{role:'assistant',content:fullText}];
      throw error;
    }
  }

  async function run(text?: string, wakeCommand = false) {
    if (busy.current) return;
    if (voiceRef.current) {
      try {
        speech.current ??= new SpeechPlayer();
        speech.current.unlock();
      } catch {
        /* Chat remains available without audio. */
      }
    }
    busy.current = true;
    setPhase(text ? "thinking" : "listening");
    setError("");
    const ctrl = new AbortController();
    controller.current = ctrl;
    try {
      await recognition.current?.pause();
      ctrl.signal.throwIfAborted();
      let followUp = false;
      if (text) followUp = await answer(text, ctrl.signal);
      while (!text || followUp) {
        text = undefined;
        setShowControls(true);
        setPhase("listening");
        const blob = await recordQuestion(() => {}, ctrl.signal,
          wakeCommand ? () => setEyesLit(true) : undefined);
        setEyesLit(false);
        wakeCommand = false;
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
        followUp = await answer(question, ctrl.signal);
        if (!followUp || document.hidden) break;
      }
    } catch (e) {
      if (!ctrl.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Microphone unavailable. Please use chat.",
        );
    } finally {
      setEyesLit(false);
      busy.current = false;
      setPhase("standby");
      controller.current = null;
      if (!document.hidden) recognition.current?.start();
    }
  }
  askRef.current = () => {
    void run(undefined, true);
  };
  function toggleWake() {
    if (wake) {
      recognition.current?.dispose();
      recognition.current = null;
      setWake(false);
      return;
    }
    const Constructor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) {
      setError(
        "This browser does not expose speech recognition. Open Jarvis in Safari 16.4+ or Chrome, or use push-to-talk/chat.",
      );
      return;
    }
    setError("");
    try {
      speech.current ??= new SpeechPlayer();
      speech.current.unlock();
      const listener = new WakeListener(
        new Constructor(),
        () => askRef.current(),
        (message) => {
          setError(message);
          setWake(false);
          recognition.current = null;
        },
      );
      recognition.current = listener;
      setWake(true);
      listener.start(); // Synchronous user activation is required by Safari.
    } catch {
      setWake(false);
      setError(
        "Wake listening could not start. Check Safari microphone permissions.",
      );
    }
  }
  useEffect(() => {
    const visibility = () => {
      if (document.hidden)
        void recognition.current
          ?.pause()
          .then(() => {
            if (!document.hidden && !busy.current) recognition.current?.start();
          })
          .catch(() => {
            setWake(false);
          });
      else if (!busy.current) recognition.current?.start();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  const cancel = () => {
    controller.current?.abort();
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
            Jarvis<small>MARK 50</small>
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
              Personal workspace<small>JARVIS / MARK 50</small>
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
          <button className="model-toggle" aria-expanded={showControls} aria-controls="jarvis-voice-controls" onClick={() => setShowControls(value => !value)}>{showControls ? "Hide voice controls" : "Show voice controls"}</button>
          <div className="system-status">
            <span className="green-dot" /> INTERFACE READY
          </div>
        </header>
        <div className="workspace-body">
          <section className={"command-stage model-expanded " + (showControls ? "controls-visible" : "controls-hidden")}>
            <div className="stage-top">
              <span className="eyebrow">PERSONAL INTELLIGENCE INTERFACE</span>
              <span className="version">
                MK. L <span>↗</span>
              </span>
            </div>
            <div className="hero">
              <Reactor active={eyesLit} />
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />

              <div className="reactor-label">
                <span className="tiny-cross">+</span> MK3 HELMET{" "}
                <span className="muted">/ 01</span>
              </div>
              <div className="reactor-coordinate">
                CORE SYSTEM
                <br />
                <span>NEURAL INTERFACE</span>
              </div>
              <div className="hero-copy" hidden={!showControls}>
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
            <div className="interaction" id="jarvis-voice-controls" hidden={!showControls}>
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
                  onClick={toggleWake}
                  disabled={phase !== "standby"}
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
                <span>FIRST TEXT</span>
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
