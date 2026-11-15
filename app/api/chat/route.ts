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
    const messages = validateMessages((await request.json()).messages);
    const model = process.env.NVIDIA_CHAT_MODEL || "z-ai/glm-5.3-flash";
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
          messages: [
            {
              role: "system",
              content:
                "You are Jarvis, a calm, capable personal AI assistant. Answer directly and accurately. For everyday conversation, use 1–3 short sentences and skip introductions and restating the question. Provide detailed responses only when requested. Do not pretend to have live data or device control.",
            },
            ...messages,
          ],
          max_tokens: detailed ? 8192 : 4096,
          ...(model === "z-ai/glm-5.3-flash"
            ? { reasoning_effort: "low", chat_template_kwargs: { clear_thinking: true } }
            : { chat_template_kwargs: { enable_thinking: false } }),
          temperature: 0.6,
        }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(180000)]),
      },
    );
    if (!result.ok) throw upstreamError(result.status);
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
