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
    const result = await fetch(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model:
            process.env.NVIDIA_CHAT_MODEL ||
            "nvidia/nemotron-3.5-lightning-30b-a3b",
          messages: [
            {
              role: "system",
              content:
                "You are Jarvis, a calm, capable personal AI assistant. Answer accurately and concisely, usually in 2–4 sentences. Do not pretend to have live data or device control.",
            },
            ...messages,
          ],
          max_tokens: 1024,
          chat_template_kwargs: { enable_thinking: false },
          temperature: 0.6,
        }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(60000)]),
      },
    );
    if (!result.ok) throw upstreamError(result.status);
    const data = await result.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text)
      throw new Error("NVIDIA returned an empty answer. Please try again.");
    return Response.json({ text });
  } catch (error) {
    return failure(error);
  }
}
