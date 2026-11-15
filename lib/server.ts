export function authorize(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new Error("Cross-origin requests are not allowed.");
  const key = process.env.NVIDIA_API_KEY;
  if (!key)
    throw new Error("Add NVIDIA_API_KEY to .env.local and restart Jarvis.");
  return key;
}
export function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed.";
  return Response.json({ error: message }, { status: 400 });
}
export function upstreamError(status: number) {
  return new Error(
    status === 401 || status === 403
      ? "NVIDIA rejected the API key or model access. Check your NVIDIA account."
      : `NVIDIA is unavailable (${status}). Please try again.`,
  );
}
export type Message = { role: "user" | "assistant"; content: string };
export function validateMessages(value: unknown): Message[] {
  if (!Array.isArray(value) || !value.length || value.length > 24)
    throw new Error("Send 1–24 conversation messages.");
  return value.map((m) => {
    if (
      !m ||
      !["user", "assistant"].includes(m.role) ||
      typeof m.content !== "string" ||
      !m.content.trim() ||
      m.content.length > 4000
    )
      throw new Error(
        "Invalid message. Limit each message to 4,000 characters.",
      );
    return { role: m.role, content: m.content };
  });
}
