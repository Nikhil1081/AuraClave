import { useEffect, useState, useRef } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { LiveKitRoom, VideoConference, RoomAudioRenderer } from "@livekit/components-react";
import { LoaderCircle, Share2 } from "lucide-react";
import Brand from "../components/Brand";
import MeetingExtensions from "../components/MeetingExtensions";
import ShareMeetingModal from "../components/ShareMeetingModal";
import WaitingRoom from "../components/WaitingRoom";
import HostAdmissionBanner from "../components/HostAdmissionBanner";
import { useAuth } from "../contexts/AuthContext";

function getApiBase(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && typeof envUrl === "string") {
    return envUrl.replace(/\/$/, "");
  }
  return "";
}

export default function Meeting() {
  const { roomName = "" } = useParams();
  const location = useLocation();
  const { session } = useAuth();
  const isCreatedByMe = Boolean(
    (location.state as any)?.isHost ||
    (typeof sessionStorage !== "undefined" && sessionStorage.getItem(`auraclave_host_${roomName}`) === "true")
  );
  const [token, setToken] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [admissionStatus, setAdmissionStatus] = useState<"checking" | "admitted" | "waiting" | "rejected">("checking");
  const [isHost, setIsHost] = useState(isCreatedByMe);
  const [showShareModal, setShowShareModal] = useState(false);
  const [quickCopied, setQuickCopied] = useState(false);
  const pollTimerRef = useRef<any>(null);

  // 1. Initial Request to Join
  useEffect(() => {
    let active = true;

    async function checkJoin() {
      if (!session?.access_token) {
        setError("Your session has expired. Please sign in again.");
        setLoading(false);
        return;
      }

      const base = getApiBase();
      const url = base ? `${base}/api/room/${roomName}/join-request` : `/api/room/${roomName}/join-request`;

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`
          }
        });

        if (!res.ok) {
          // Fallback to direct admission and preserve host status
          if (active) {
            setIsHost(isCreatedByMe);
            setAdmissionStatus("admitted");
            fetchToken();
          }
          return;
        }

        const data = await res.json();
        if (active) {
          setIsHost(Boolean(data.isHost));
          setAdmissionStatus(data.status);

          if (data.status === "admitted") {
            fetchToken();
          } else if (data.status === "waiting") {
            setLoading(false);
            startPollingAdmission();
          } else {
            setLoading(false);
          }
        }
      } catch {
        if (active) {
          setAdmissionStatus("admitted");
          fetchToken();
        }
      }
    }

    async function fetchToken() {
      try {
        const base = getApiBase();
        const apiUrl = base ? `${base}/api/token` : "/api/token";
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ roomName })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not join this meeting.");
        if (active) {
          setToken(data.token);
          setServerUrl(data.serverUrl);
          setAdmissionStatus("admitted");
        }
      } catch (err: any) {
        if (active) setError(err instanceof Error ? err.message : "Unable to connect.");
      } finally {
        if (active) setLoading(false);
      }
    }

    function startPollingAdmission() {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(async () => {
        if (!session?.access_token) return;
        const base = getApiBase();
        const checkUrl = base ? `${base}/api/room/${roomName}/check-admission` : `/api/room/${roomName}/check-admission`;
        try {
          const res = await fetch(checkUrl, {
            headers: { Authorization: `Bearer ${session.access_token}` }
          });
          if (res.ok) {
            const data = await res.json();
            if (data.status === "admitted") {
              clearInterval(pollTimerRef.current);
              setAdmissionStatus("admitted");
              setLoading(true);
              fetchToken();
            } else if (data.status === "rejected") {
              clearInterval(pollTimerRef.current);
              setAdmissionStatus("rejected");
            }
          }
        } catch {}
      }, 2000);
    }

    checkJoin();

    return () => {
      active = false;
      clearInterval(pollTimerRef.current);
    };
  }, [roomName, session?.access_token]);

  // Handle Waiting Room view
  if (admissionStatus === "waiting" || admissionStatus === "rejected") {
    return <WaitingRoom roomName={roomName} status={admissionStatus} />;
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <LoaderCircle className="spin" /> Preparing your meeting…
      </div>
    );
  }

  if (error) {
    return (
      <div className="center-page">
        <div className="setup-card">
          <Brand />
          <h2>Unable to join</h2>
          <p className="muted">{error}</p>
          <Link className="button primary full" to="/dashboard">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="meeting-page">
      <header className="meeting-header">
        <Link to="/dashboard" className="meeting-brand">
          <Brand small />
          <span className="meeting-divider" />
          <span className="meeting-room-label">Meeting room</span>
        </Link>
        <div className="meeting-header-actions">
          <div className="meeting-room-id">
            <span className="status-dot" /> {roomName}
          </div>

          {/* Host Controls Pill */}
          {isHost && <HostAdmissionBanner roomName={roomName} />}

          <button
            className={`meeting-share-pill ${quickCopied ? "copied" : ""}`}
            onClick={() => setShowShareModal(true)}
            title="Share meeting link"
            type="button"
          >
            <Share2 size={14} />
            <span>{quickCopied ? "Link Copied!" : "Share Link"}</span>
          </button>
        </div>
      </header>

      <div className="meeting-content">
        <LiveKitRoom
          video
          audio
          token={token}
          serverUrl={serverUrl}
          connect
          onDisconnected={() => {}}
          data-lk-theme="default"
          className="livekit-room"
        >
          <VideoConference />
          <RoomAudioRenderer />
          <MeetingExtensions
            roomName={roomName}
            onOpenShare={() => setShowShareModal(true)}
          />
        </LiveKitRoom>
      </div>

      <ShareMeetingModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        roomName={roomName}
      />
    </div>
  );
}
