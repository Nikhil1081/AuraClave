import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AccessToken } from "livekit-server-sdk";
import { getAuthenticatedUser } from "./_lib/auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = await getAuthenticatedUser(req);
    const { roomName } = req.body ?? {};

    if (typeof roomName !== "string" || !/^[a-zA-Z0-9_-]{3,80}$/.test(roomName)) {
      return res.status(400).json({ error: "Invalid meeting room name." });
    }

    const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return res.status(500).json({ error: "LiveKit server credentials are not configured." });
    }

    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: user.id,
      name: user.user_metadata?.full_name || user.email || "AuraClave guest",
      ttl: "2h"
    });

    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    });

    return res.status(200).json({ token: await token.toJwt(), serverUrl: LIVEKIT_URL });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create meeting token.";
    const status = message.includes("sign in") || message.includes("session") ? 401 : 500;
    return res.status(status).json({ error: message });
  }
}