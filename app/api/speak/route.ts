import { authorize, failure } from "@/lib/server";

const voiceId = "wDsJlOXPqcvIUKdLXjDs";

export async function POST(request: Request) {
  try {
    authorize(request);
    const { text } = await request.json();
    if (typeof text !== "string" || !text.trim() || text.length > 6000)
      throw new Error("Invalid speech text.");

    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) throw new Error("Add ELEVENLABS_API_KEY to .env.local and restart Jarvis.");
    const result = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
        signal: request.signal,
      },
    );
    if (!result.ok)
      throw new Error(`ElevenLabs speech request failed (HTTP ${result.status}). Check your API key, voice access, and available credits.`);
    return new Response(result.body, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
