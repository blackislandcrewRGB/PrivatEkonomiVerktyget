/**
 * Push notifications through ntfy (NTFY_TOPIC in .env: a topic on ntfy.sh, or
 * a whole URL for another server). Published as JSON so titles can have å, ä
 * and ö (a header can't). Only the real instance has a topic.
 */
export interface Ntfy {
  title: string;
  message: string;
  tags?: string[];
  /** Render the message as Markdown (the web app and desktop). */
  markdown?: boolean;
}

export function ntfyTarget(topic: string): { server: string; topic: string } | null {
  if (!topic) return null;
  if (!/^https?:\/\//.test(topic)) return { server: "https://ntfy.sh", topic };
  const url = new URL(topic);
  const name = url.pathname.split("/").filter(Boolean).at(-1);
  return name ? { server: url.origin, topic: name } : null;
}

/** True when ntfy took it. Never throws: a notification that doesn't arrive mustn't stop what sent it. */
export async function sendNtfy(topic: string, n: Ntfy): Promise<boolean> {
  const target = ntfyTarget(topic);
  if (!target) return false;
  try {
    const res = await fetch(target.server, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: target.topic, title: n.title, message: n.message, tags: n.tags, markdown: n.markdown }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
