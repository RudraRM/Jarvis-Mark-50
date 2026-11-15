import {
  authorize,
  failure,
  upstreamError,
  validateMessages,
} from "@/lib/server";
export async function POST(request: Request) {
  try {
    const key = authorize(request);
    if (Number(request.headers.get("content-length")) > 120000)
      throw new Error("Conversation too large.");
    const body = await request.json();
    const messages = validateMessages(body.messages);
    const streaming = body.stream === true;
    const model = process.env.NVIDIA_CHAT_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b";
    const detailed = /\b(detail(?:ed)?|comprehensive|thorough|research|long|step.by.step|explain fully)\b/i.test(messages.at(-1)?.content || "");
    const result = await fetch(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          stream: streaming,
          messages: [
            {
              role: "system",
              content:
                "You are Jarvis, a calm, capable personal AI assistant. Answer directly and accurately. For everyday conversation, use 1–3 short sentences and skip introductions and restating the question. Provide detailed responses only when requested. Do not pretend to have live data or device control.",
            },
            ...messages,
          ],
          max_tokens: detailed ? 8192 : 4096,
          chat_template_kwargs: { enable_thinking: false },
          temperature: 0.6,
        }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(180000)]),
      },
    );
    if (!result.ok) throw upstreamError(result.status);
    if (streaming) return new Response(result.body, {headers:{
      "Content-Type":"text/event-stream", "Cache-Control":"no-cache, no-transform", "X-Accel-Buffering":"no"
    }});
    const data = await result.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text)
      throw new Error("NVIDIA returned an empty answer. Please try again.");
    return Response.json({
      text,
      truncated: data.choices?.[0]?.finish_reason === "length",
    });
  } catch (error) {
    return failure(error);
  }
}
