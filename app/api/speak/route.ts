import { authorize, failure, upstreamError } from "@/lib/server";
export async function POST(request: Request) {
  try {
    const key = authorize(request);
    const { text } = await request.json();
    if (typeof text !== "string" || !text.trim() || text.length > 6000)
      throw new Error("Invalid speech text.");
    const form = new FormData();
    Object.entries({
      text,
      language: "en-US",
      voice: process.env.NVIDIA_TTS_VOICE || "Magpie-Multilingual.EN-US.Aria",
      encoding: "LINEAR_PCM",
      sample_rate_hz: "44100",
    }).forEach(([k, v]) => form.set(k, v));
    const result = await fetch(
      "https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com/v1/audio/synthesize",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(60000)]),
      },
    );
    if (!result.ok) throw upstreamError(result.status);
    return new Response(await result.arrayBuffer(), {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
