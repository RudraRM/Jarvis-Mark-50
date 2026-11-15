import { authorize, failure, upstreamError } from "@/lib/server";
export async function POST(request: Request) {
  try {
    const key = authorize(request);
    const data = Buffer.from(await request.arrayBuffer());
    if (
      data.length < 44 ||
      data.length > 1000000 ||
      data.toString("ascii", 0, 4) !== "RIFF"
    )
      throw new Error("Send a WAV recording under 30 seconds.");
    const form = new FormData();
    form.set("language", "en-US");
    form.set("file", new Blob([data], { type: "audio/wav" }), "question.wav");
    const response = await fetch(
      "https://1598d209-5e27-4d3c-8079-4751568b1081.invocation.api.nvcf.nvidia.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(45000)]),
      },
    );
    if (!response.ok) throw upstreamError(response.status);
    const result = await response.json();
    if (typeof result.text !== "string")
      throw new Error(
        "NVIDIA returned an invalid transcription. Please try again.",
      );
    return Response.json({ text: result.text.trim() });
  } catch (error) {
    return failure(error);
  }
}
