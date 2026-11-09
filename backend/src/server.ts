import express, { type Request, type Response } from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import { getAuthenticatedUser, generateToken } from "./auth.js";
import { createUser, findUserByEmail, verifyPassword, updateUserProfile } from "./db.js";
import { AuraWeaveSignaler } from "./auraweave.js";
import {
  requestToJoin,
  checkAdmission,
  setAdmissionDecision,
  updateRoomSettings,
  getWaitingList,
  getRoom
} from "./roomManager.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

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
      ? "Extract clear, humanized action items from these meeting notes. Highlight owners and next steps naturally. Avoid robotic phrasing."
      : "Write humanized, professional, and well-structured meeting notes. Use friendly yet executive language with clean bullet points. Include:\n- ✨ Executive Overview\n- 💡 Key Takeaways & Highlights\n- 🚀 Next Steps & Action Items\nMake it feel like a smart Chief of Staff wrote it, not a machine.";

    // Active high-speed Groq models
    const primaryModel =
      process.env.GROQ_MODEL && !process.env.GROQ_MODEL.includes("llama-3.3-70b")
        ? process.env.GROQ_MODEL
        : "openai/gpt-oss-120b";

    async function callGroq(modelName: string) {
      return fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          temperature: 0.5,
          messages: [
            {
              role: "system",
              content:
                "You are an empathetic, articulate executive assistant. You write clean, natural, humanized meeting minutes with clear structure and warmth. Avoid stiff or robotic phrases like 'None documented' or 'As an AI'. If the notes are brief or from a solo session, provide a warm, encouraging summary."
            },
            { role: "user", content: `${prompt}\n\nMeeting conversation:\n${text}` }
          ]
        })
      });
    }

    let response = await callGroq(primaryModel);
    let data = await response.json();

    // Fallback if model ID doesn't exist on this API key
    if (!response.ok && data?.error?.message?.includes("does not exist")) {
      response = await callGroq("openai/gpt-oss-20b");
      data = await response.json();
    }

    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || "Groq request failed." });
    return res.status(200).json({ result: data.choices?.[0]?.message?.content || "No response generated." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI request failed.";
    return res.status(401).json({ error: message });
  }
});

// --- Waiting Room & Admission Endpoints ---

// 1. Request to join a room
app.post("/api/room/:roomName/join-request", async (req: Request, res: Response) => {

  try {
    const user = await getAuthenticatedUser(req);
    const roomName = String(req.params.roomName);

    const result = requestToJoin(roomName, {
      id: user.id,
      name: user.user_metadata?.full_name || user.email,
      email: user.email,
      avatarUrl: user.user_metadata?.avatar_url
    });

    const room = getRoom(roomName);

    return res.status(200).json({
      ...result,
      openToAll: room?.openToAll ?? true,
      waitingRoomEnabled: room?.waitingRoomEnabled ?? false
    });
  } catch (err: any) {
    return res.status(401).json({ error: err?.message || "Authentication failed." });
  }
});

// 2. Check admission status (for waiting participants)
app.get("/api/room/:roomName/check-admission", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    const roomName = String(req.params.roomName);
    const result = checkAdmission(roomName, user.id);
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(401).json({ error: err?.message || "Authentication failed." });
  }
});

// 3. Host: Get waiting list and room admission settings
app.get("/api/room/:roomName/waiting", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    const roomName = String(req.params.roomName);
    const room = getRoom(roomName);

    if (!room || room.hostId !== user.id) {
      return res.status(200).json({
        isHost: false,
        openToAll: room?.openToAll ?? true,
        waitingRoomEnabled: room?.waitingRoomEnabled ?? false,
        waitingList: []
      });
    }

    const waitingList = getWaitingList(roomName, user.id);
    return res.status(200).json({
      isHost: true,
      openToAll: room.openToAll,
      waitingRoomEnabled: room.waitingRoomEnabled,
      waitingList
    });
  } catch (err: any) {
    return res.status(401).json({ error: err?.message || "Authentication failed." });
  }
});

// 4. Host: Make decision (admit / reject)
app.post("/api/room/:roomName/decision", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    const roomName = String(req.params.roomName);
    const { participantId, decision } = req.body ?? {};

    if (!participantId || !["admit", "reject"].includes(decision)) {
      return res.status(400).json({ error: "Invalid decision parameters." });
    }

    const success = setAdmissionDecision(roomName, user.id, participantId, decision);
    if (!success) {
      return res.status(403).json({ error: "Only the meeting host can admit or reject participants." });
    }

    const waitingList = getWaitingList(roomName, user.id);
    return res.status(200).json({ success: true, waitingList });
  } catch (err: any) {
    return res.status(401).json({ error: err?.message || "Authentication failed." });
  }
});

// 5. Host: Update room settings (Open to All / Waiting Room Enabled)
app.patch("/api/room/:roomName/settings", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    const roomName = String(req.params.roomName);
    const { openToAll, waitingRoomEnabled } = req.body ?? {};

    const updated = updateRoomSettings(roomName, user.id, { openToAll, waitingRoomEnabled });
    if (!updated) {
      return res.status(403).json({ error: "Only the meeting host can update room settings." });
    }

    return res.status(200).json({
      openToAll: updated.openToAll,
      waitingRoomEnabled: updated.waitingRoomEnabled,
      waitingCount: updated.waitingList.size
    });
  } catch (err: any) {
    return res.status(401).json({ error: err?.message || "Authentication failed." });
  }
});

const server = http.createServer(app);
new AuraWeaveSignaler(server);

server.listen(port, () => {
  console.log(`AuraClave backend with AuraWeave RTC running on port ${port}`);
});
