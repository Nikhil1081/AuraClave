import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert, ArrowLeft, LoaderCircle, Users } from "lucide-react";
import Brand from "./Brand";

interface WaitingRoomProps {
  roomName: string;
  status: "waiting" | "rejected";
  onCheckAgain?: () => void;
}

export default function WaitingRoom({ roomName, status }: WaitingRoomProps) {
  useEffect(() => {
    // Play a gentle sound or ambient indicator if desired
  }, []);

  return (
    <div className="waiting-room-shell">
      <div className="waiting-room-card">
        <Brand />

        {status === "waiting" ? (
          <>
            <div className="waiting-pulse-avatar">
              <div className="pulse-ring ring-1" />
              <div className="pulse-ring ring-2" />
              <div className="pulse-icon">
                <Users size={32} color="#a78bfa" />
              </div>
            </div>

            <div className="eyebrow">AWAITING ADMISSION</div>
            <h2>Waiting for host to let you in</h2>
            <p className="muted">
              You are in the waiting room for: <code>{roomName}</code>.<br />
              The meeting host has been notified of your arrival. You will enter automatically once admitted.
            </p>

            <div className="waiting-indicator">
              <LoaderCircle size={18} className="spin" />
              <span>Checking with host…</span>
            </div>

            <div className="waiting-card-actions">
              <Link to="/dashboard" className="button secondary full">
                <ArrowLeft size={16} /> Leave Waiting Room
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="waiting-rejected-icon">
              <ShieldAlert size={36} color="#f87171" />
            </div>
            <div className="eyebrow error">ADMISSION DECLINED</div>
            <h2>Entry Request Declined</h2>
            <p className="muted">
              The host was unable to admit you to meeting room <code>{roomName}</code> at this time.
            </p>

            <div className="waiting-card-actions">
              <Link to="/dashboard" className="button primary full">
                <ArrowLeft size={16} /> Back to Dashboard
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
