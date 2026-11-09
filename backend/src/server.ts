import express, { type Request, type Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { AccessToken } from "livekit-server-sdk";
import { getAuthenticatedUser, generateToken } from "./auth.js";
import { createUser, findUserByEmail, verifyPassword, updateUserProfile } from "./db.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Health check endpoint for Render
app.get("/", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "AuraClave API", timestamp: new Date().toISOString() });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "healthy" });
});

// Authentication: Sign Up
app.post("/api/auth/signup", async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body ?? {};

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ error: "Please provide a valid email address." });
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long." });
    }

    const user = await createUser(email, password, name || "");
    const token = generateToken(user);

    return res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        user_metadata: {
          full_name: user.fullName,
          avatar_url: user.avatarUrl || ""
        }
      },
      token
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Sign up failed." });
  }
});

// Authentication: Login
app.post("/api/auth/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ error: "Please enter your email and password." });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(400).json({ error: "Invalid email or password." });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return res.status(400).json({ error: "Invalid email or password." });
    }

    const token = generateToken(user);

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        user_metadata: {
          full_name: user.fullName,
          avatar_url: user.avatarUrl || ""
        }
      },
      token
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Login failed." });
  }
});

// Authentication: Update Profile (Username & DP)
app.patch("/api/auth/profile", async (req: Request, res: Response) => {
  try {
    const authUser = await getAuthenticatedUser(req);
    const { fullName, avatarUrl } = req.body ?? {};

    const updatedUser = await updateUserProfile(authUser.id, {
      fullName,
      avatarUrl
    });

    const token = generateToken(updatedUser);

    return res.status(200).json({
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        user_metadata: {
          full_name: updatedUser.fullName,
          avatar_url: updatedUser.avatarUrl || ""
        }
      },
      token
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Failed to update profile." });
  }
});

// Authentication: Get current session user
app.get("/api/auth/me", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    return res.status(200).json({ user });
  } catch (err: any) {
    return res.status(401).json({ error: err?.message || "Not authenticated." });
  }
});

// LiveKit token endpoint
app.post("/api/token", async (req: Request, res: Response) => {
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
      metadata: JSON.stringify({
        avatar_url: user.user_metadata?.avatar_url || ""
      }),
      ttl: "24h"
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
});

// Groq AI summary endpoint
app.post("/api/ai", async (req: Request, res: Response) => {
  try {
    await getAuthenticatedUser(req);
    const { text, task = "summarize" } = req.body ?? {};
    if (typeof text !== "string" || text.trim().length < 10 || text.length > 20000) {
      return res.status(400).json({ error: "Provide meeting notes between 10 and 20,000 characters." });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: "Groq is not configured yet. Add GROQ_API_KEY in your server environment." });
    }

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
});

app.listen(port, () => {
  console.log(`AuraClave backend running on port ${port}`);
});
