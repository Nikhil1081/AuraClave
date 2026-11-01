import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { LiveKitRoom, VideoConference, RoomAudioRenderer } from "@livekit/components-react";
import { ArrowLeft, LoaderCircle, Video } from "lucide-react";
import Brand from "../components/Brand";
import MeetingExtensions from "../components/MeetingExtensions";
import { useAuth } from "../contexts/AuthContext";

export default function Meeting() {
  const { roomName = "" } = useParams();
  const { session } = useAuth();
  const [token, setToken] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function connect() {
      try {
        if (!session?.access_token) throw new Error("Your session has expired. Please sign in again.");
        const apiUrl = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api/token` : "/api/token";
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ roomName })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not join this meeting.");
        if (active) { setToken(data.token); setServerUrl(data.serverUrl); }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Unable to connect.");
      } finally { if (active) setLoading(false); }
    }
    connect();
    return () => { active = false; };
  }, [roomName, session?.access_token]);

  if (loading) return <div className="loading-screen"><LoaderCircle className="spin"/> Preparing your meeting…</div>;
  if (error) return <div className="center-page"><div className="setup-card"><Brand/><h2>Unable to join</h2><p className="muted">{error}</p><Link className="button primary full" to="/dashboard">Back to dashboard</Link></div></div>;

  return <div className="meeting-page"><header className="meeting-header"><Link to="/dashboard" className="meeting-brand"><Brand small/><span className="meeting-divider"/> <span className="meeting-room-label">Meeting room</span></Link><div className="meeting-room-id"><span className="status-dot"/> {roomName}</div></header><div className="meeting-content"><LiveKitRoom video audio token={token} serverUrl={serverUrl} connect onDisconnected={()=>{}} data-lk-theme="default" className="livekit-room"><VideoConference/><RoomAudioRenderer/><MeetingExtensions roomName={roomName} /></LiveKitRoom></div></div>;
}