import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const apps: Record<string, string> = { spotify: "Spotify", safari: "Safari", calculator: "Calculator", notes: "Notes", reminders: "Reminders", calendar: "Calendar", music: "Music" };

export async function localAction(raw: string, request: Request): Promise<string | null> {
  const command = raw.trim().replace(/^(?:please |(?:can|could|would) you (?:please )?)/i, "").replace(/[.!?]+$/, "").trim();
  const open = /^(?:open|launch|visit|go to)\s+(.+)$/i.exec(command);
  const reminder = /^remind me in (\d+) (minutes?|hours?|days?) to (.+)$/i.exec(command);
  const hooks: Record<string, unknown> = JSON.parse(process.env.JARVIS_WEBHOOKS || "{}");
  const phrase = command.toLowerCase();
  const hook = Object.hasOwn(hooks, phrase) ? hooks[phrase] : undefined;
  if (!open && !reminder && typeof hook !== "string") {
    if (/^(?:remind me|set (?:a |an )?reminder)/i.test(command))
      return "Please say “Remind me in 10 minutes to” followed by the task.";
    if (/^(?:trigger|turn on|turn off|switch on|switch off|activate)\b/i.test(command))
      return "That device action is not registered.";
    return null;
  }
  const origin = new URL(request.url);
  if (!localHosts.has(origin.hostname) || request.headers.get("origin") !== origin.origin ||
      !request.headers.get("content-type")?.startsWith("application/json"))
    return "Device actions are available only from the local Jarvis dashboard.";
  try {
    if (typeof hook === "string") {
      const response = await fetch(hook, { method: "POST", redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]) });
      return response.ok ? "The smart-home service accepted the command." : "The smart-home service rejected the command.";
    }
    if (process.platform !== "darwin") return "This desktop action requires Jarvis to run locally on a Mac.";
    const options = { timeout: 15000, signal: request.signal };
    if (open) {
      const target = open[1].trim().toLowerCase();
      if (Object.hasOwn(apps, target)) {
        await execute("/usr/bin/open", ["-a", apps[target]], options);
        return "Launching " + apps[target] + ".";
      }
      if (!/^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#][^\s]*)?$/i.test(open[1]))
        return "That app is not registered. For a website, give me its web address.";
      const url = new URL(/^https?:\/\//i.test(open[1]) ? open[1] : "https://" + open[1]);
      await execute("/usr/bin/open", [url.href], options);
      return "Opening the website.";
    }
    if (reminder) {
      const seconds = Number(reminder[1]) * (/^day/i.test(reminder[2]) ? 86400 : /^hour/i.test(reminder[2]) ? 3600 : 60);
      if (seconds < 1 || seconds > 31536000) return "Choose a reminder time within the next year.";
      const script = 'on run argv\nset dueDate to (current date) + (item 1 of argv as integer)\nset taskName to item 2 of argv\ntell application "Reminders" to make new reminder at end of reminders of default list with properties {name:taskName, remind me date:dueDate}\nend run';
      await execute("/usr/bin/osascript", ["-e", script, String(seconds), reminder[3]], options);
      return "Your reminder is set.";
    }
  } catch {
    return "I couldn’t confirm that the action completed.";
  }
  return null;
}

export async function searchWeb(query: string, signal: AbortSignal): Promise<string | null> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ query: query.slice(0, 400), max_results: 5, search_depth: "basic" }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const results = (data.results || []).filter((r: {content?: string}) => typeof r.content === "string" && r.content.trim())
      .map((r: {title: string; content: string}) => ({ title: r.title, excerpt: r.content.slice(0, 1500) }));
    return results.length ? JSON.stringify(results) : null;
  } catch { return null; }
}
