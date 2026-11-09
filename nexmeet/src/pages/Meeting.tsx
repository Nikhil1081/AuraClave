import { useEffect, useState, useRef } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import Brand from "../components/Brand";
import WaitingRoom from "../components/WaitingRoom";
import AuraWeaveConference from "../components/AuraWeaveConference";
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

  const [admissionStatus, setAdmissionStatus] = useState<"checking" | "admitted" | "waiting" | "rejected">("checking");
  const [isHost, setIsHost] = useState(isCreatedByMe);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pollTimerRef = useRef<any>(null);

  useEffect(() => {
    let active = true;

    async function checkJoin() {
      if (!session?.access_token) {
        // Allow guests/anonymous or require signin
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
          // Direct admission fallback
          if (active) {
            setIsHost(isCreatedByMe);
            setAdmissionStatus("admitted");
            setLoading(false);
          }
          return;
        }

        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          if (active) {
            setIsHost(isCreatedByMe);
            setAdmissionStatus("admitted");
            setLoading(false);
          }
          return;
        }

        const data = await res.json();
        if (active) {
          setIsHost(Boolean(data.isHost));
          setAdmissionStatus(data.status);
          setLoading(false);

          if (data.status === "waiting") {
            startPollingAdmission();
          }
        }
      } catch {
        if (active) {
          setIsHost(isCreatedByMe);
          setAdmissionStatus("admitted");
          setLoading(false);
        }
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

  // Handle Waiting Room / Rejected view
  if (admissionStatus === "waiting" || admissionStatus === "rejected") {
    return <WaitingRoom roomName={roomName} status={admissionStatus} />;
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <LoaderCircle className="spin" /> Preparing your meeting with AuraWeave RTC™…
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

  // AuraWeave RTC™ 100% Free Peer-to-Peer Video Room
  return <AuraWeaveConference roomName={roomName} isHost={isHost} />;
}
