import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser } from "./_lib/auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    await getAuthenticatedUser(req);
    const { text, task = "summarize" } = req.body ?? {};
    if (typeof text !== "string" || text.trim().length < 10 || text.length > 20000) {
      return res.status(400).json({ error: "Provide meeting notes between 10 and 20,000 characters." });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(503).json({ error: "Groq is not configured yet. Add GROQ_API_KEY in your server environment." });

    const prompt = task === "action-items"
      ? "Extract clear action items from these meeting notes. Include owner and deadline only if stated. Do not invent details."
      : "Create concise, structured meeting minutes with: Summary, Key decisions, Action items, and Open questions. Do not invent details.";

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        temperature: 0.3,
        messages: [
          { role: "system", content: "You are a precise meeting assistant. Only use information in the supplied notes." },
          { role: "user", content: `${prompt}\n\nMeeting notes:\n${text}` }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || "Groq request failed." });
    return res.status(200).json({ result: data.choices?.[0]?.message?.content || "No response generated." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI request failed.";
    return res.status(401).json({ error: message });
  }
}