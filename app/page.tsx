"use client";
import { useEffect, useRef, useState } from "react";
import "./console.css";
import { readChatStream } from "@/lib/chat-stream";
import { recordQuestion } from "@/lib/audio";
import type { Message } from "@/lib/server";
import { WakeListener } from "@/lib/wake";
import { SpeechPlayer, speechChunks } from "@/lib/speech";
function makeIcon(path: string) {
  return function Icon() {
    return <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>;
  };
}

const House = makeIcon("M3 10 12 3l9 7v11h-7v-7h-4v7H3Z");
const MessageCircle = makeIcon("M21 11a9 9 0 0 1-13 8l-5 2 1-5a9 9 0 1 1 17-5Z");
const LayoutGrid = makeIcon("M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z");
const Mic = makeIcon("M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z M5 11v1a7 7 0 0 0 14 0v-1 M12 19v3");
const Maximize = makeIcon("M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6");
const Laptop = makeIcon("M4 4h16v13H4z M2 20h20");
const Globe = makeIcon("M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M2 12h20 M12 2q-9 10 0 20 9-10 0-20z");
const Code = makeIcon("M7 6l-6 6 6 6 M17 6l6 6-6 6 M15 3 9 21");
const ListChecks = makeIcon("M3 6l2 2 3-4 M11 6h10 M3 16l2 2 3-4 M11 16h10");
const Send = makeIcon("M22 2 15 22l-4-9-9-4z M11 13 22 2");
const Volume2 = makeIcon("M3 9h4l5-5v16l-5-5H3z M16 8q4 4 0 8 M19 5q7 7 0 14");
const AudioLines = makeIcon("M3 10v4 M7 6v12 M12 2v20 M17 6v12 M21 10v4");
const Plus = makeIcon("M12 4v16 M4 12h16");
const X = makeIcon("M5 5l14 14 M19 5 5 19");

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
  const [chatOpen, setChatOpen] = useState(false);
  const display = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLInputElement>(null);
  function showLevel(level: number) {
    display.current?.style.setProperty("--amplitude", String(0.26 + level * 1.8));
  }
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
    setChatOpen(true);
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
            await speech.current!.play(await response.arrayBuffer(), signal, () => setPhase('speaking'), showLevel);
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
        const blob = await recordQuestion(showLevel, ctrl.signal,
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
  const shortcuts = [
    { label: "Open Apps", icon: Laptop, prompt: "Help me open an app on my device: " },
    { label: "Browse Web", icon: Globe, prompt: "Help me find search terms for: " },
    { label: "Write Code", icon: Code, prompt: "Help me write code for: " },
    { label: "Do Tasks", icon: ListChecks, prompt: "Help me plan this task: " },
  ];
  return (
    <main className="jr-console">
      <nav aria-label="Jarvis controls" className="jr-rail">
        <button title="Home" aria-pressed={!chatOpen && !showControls} onClick={() => {setChatOpen(false); setShowControls(false)}}><House /></button>
        <button title="Conversation" aria-expanded={chatOpen} onClick={() => setChatOpen(!chatOpen)}><MessageCircle /></button>
        <button title="Quick actions" onClick={() => {setChatOpen(false); setShowControls(false); document.getElementById("first-action")?.focus()}}><LayoutGrid /></button>
        <button title="Voice controls" aria-expanded={showControls} onClick={() => setShowControls(!showControls)}><Mic /></button>
        <button title="Full screen" onClick={async () => {try {if(document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen()} catch {setError("Fullscreen is unavailable in this browser.")}}}><Maximize /></button>
      </nav>
      <div className="jr-content">
        <div className="jr-heading"><h1>JARVIS</h1><p>Your Personal AI Assistant</p></div>
        <div className="jr-display" ref={display} aria-hidden="true">
          {["left","right"].map(side => <div key={side} className={"jr-wave " + side}>
            {Array.from({length: 13}, (_, i) => <i key={i} style={{height: (9 + 85 * Math.pow(1 - Math.abs(i - 6) / 6, 1.4)) + "%"}} />)}
          </div>)}
          <div className={"jr-reactor" + (eyesLit ? " lit" : "")}><div><span>▼</span></div></div>
        </div>
        <p className="jr-status" role="status">{phase === "standby" && wake ? "Waiting for “Jarvis”…" : phase === "listening" ? "Listening…" : phase === "speaking" ? "Speaking…" : labels[phase]}</p>
        <div className="jr-actions">{shortcuts.map(({label, icon: Icon, prompt}, i) => <button id={i === 0 ? "first-action" : undefined} key={label} disabled={phase !== "standby"} onClick={() => {setInput(prompt); composer.current?.focus()}}><Icon />{label}</button>)}</div>
        <form className="jr-compose" onSubmit={e => {e.preventDefault(); if(input.trim() && !busy.current){void run(input.trim()); setInput("")}}}>
          <button type="button" title={phase === "standby" ? "Ask with microphone" : "Cancel current request"} onClick={() => busy.current ? cancel() : void run()}>{phase === "standby" ? <Mic /> : <X />}</button>
          <input ref={composer} aria-label="Message Jarvis" placeholder="Ask me anything, sir..." value={input} maxLength={4000} onChange={e => setInput(e.target.value)} />
          <button title="Send message" disabled={!input.trim() || phase !== "standby"}><Send /></button>
        </form>
      </div>
      {showControls && <section className="jr-settings" aria-label="Voice controls"><button title="Close voice controls" onClick={() => setShowControls(false)}><X /></button>
        <button aria-pressed={voice} onClick={() => {setVoice(!voice); if(voice) cancel()}}><Volume2 /> Spoken answers {voice ? "on" : "off"}</button>
        <button aria-pressed={wake} disabled={phase !== "standby"} onClick={toggleWake}><AudioLines /> Wake word {wake ? "on" : "off"}</button>
        <small>Wake mode uses browser speech recognition. Questions go to NVIDIA.</small></section>}
      {chatOpen && <aside className="jr-chat"><div><strong>Conversation</strong><button title="New conversation" disabled={phase !== "standby"} onClick={() => {history.current=[]; setMessages([]); setError(""); setLatency(null)}}><Plus /></button><button title="Close conversation" onClick={() => setChatOpen(false)}><X /></button></div>
        <section>{!messages.length && <p>Ask Jarvis a question to begin.</p>}{messages.map((m,i) => <article key={i}><b>{m.role === "user" ? "You" : "Jarvis"}</b><p>{m.content}</p></article>)}<div ref={bottom} /></section>
        {latency !== null && <small>First text · {(latency/1000).toFixed(2)} s</small>}</aside>}
      {error && <div className="jr-error" role="alert">{error}<button title="Dismiss error" onClick={() => setError("")}><X /></button></div>}
    </main>
  );
}
