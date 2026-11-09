import { useState, useEffect } from "react";
import { UserCheck, UserX, Shield, Users, Check, X, Globe, Lock } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

interface WaitingUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  status: "waiting" | "admitted" | "rejected";
}

interface HostAdmissionBannerProps {
  roomName: string;
}

export function getApiBase(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && typeof envUrl === "string") {
    return envUrl.replace(/\/$/, "");
  }
  return "";
}

export default function HostAdmissionBanner({ roomName }: HostAdmissionBannerProps) {
  const { session } = useAuth();
  const [waitingList, setWaitingList] = useState<WaitingUser[]>([]);
  const [openToAll, setOpenToAll] = useState(true);
  const [waitingRoomEnabled, setWaitingRoomEnabled] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [updating, setUpdating] = useState(false);

  const fetchWaiting = async () => {
    if (!session?.access_token) return;
    const base = getApiBase();
    const url = base ? `${base}/api/room/${roomName}/waiting` : `/api/room/${roomName}/waiting`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.isHost) {
          setWaitingList(data.waitingList || []);
          setOpenToAll(data.openToAll ?? true);
          setWaitingRoomEnabled(data.waitingRoomEnabled ?? false);
        }
      }
    } catch {}
  };

  useEffect(() => {
    fetchWaiting();
    const interval = setInterval(fetchWaiting, 2500);
    return () => clearInterval(interval);
  }, [roomName, session?.access_token]);

  const handleDecision = async (participantId: string, decision: "admit" | "reject") => {
    if (!session?.access_token) return;
    const base = getApiBase();
    const url = base ? `${base}/api/room/${roomName}/decision` : `/api/room/${roomName}/decision`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ participantId, decision })
      });
      if (res.ok) {
        const data = await res.json();
        setWaitingList(data.waitingList || []);
      }
    } catch (err) {
      console.error("Decision error:", err);
    }
  };

  const handleAdmitAll = async () => {
    for (const p of waitingList) {
      await handleDecision(p.id, "admit");
    }
  };

  const handleToggleOpenToAll = async (targetOpen: boolean) => {
    if (!session?.access_token) return;
    setUpdating(true);
    const base = getApiBase();
    const url = base ? `${base}/api/room/${roomName}/settings` : `/api/room/${roomName}/settings`;
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          openToAll: targetOpen,
          waitingRoomEnabled: !targetOpen
        })
      });
      if (res.ok) {
        const data = await res.json();
        setOpenToAll(data.openToAll);
        setWaitingRoomEnabled(data.waitingRoomEnabled);
        fetchWaiting();
      }
    } catch (err) {
      console.error("Toggle error:", err);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <>
      {/* Floating Host Admission Notification when users are waiting */}
      {waitingList.length > 0 && (
        <div className="host-waiting-banner">
          <div className="host-banner-left">
            <div className="host-banner-badge">
              <Users size={16} />
              <span>{waitingList.length}</span>
            </div>
            <div className="host-banner-text">
              {waitingList.length === 1 ? (
                <>
                  <b>{waitingList[0].name}</b> is waiting to join
                </>
              ) : (
                <>
                  <b>{waitingList.length} people</b> are in the waiting room
                </>
              )}
            </div>
          </div>

          <div className="host-banner-actions">
            {waitingList.length === 1 ? (
              <>
                <button
                  type="button"
                  className="btn-admit"
                  onClick={() => handleDecision(waitingList[0].id, "admit")}
                >
                  <UserCheck size={14} /> Allow Entry
                </button>
                <button
                  type="button"
                  className="btn-reject"
                  onClick={() => handleDecision(waitingList[0].id, "reject")}
                >
                  <UserX size={14} /> Reject
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn-admit" onClick={handleAdmitAll}>
                  <Check size={14} /> Admit All
                </button>
                <button
                  type="button"
                  className="btn-open-all"
                  onClick={() => handleToggleOpenToAll(true)}
                >
                  <Globe size={14} /> Open to All
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Host Controls Toggle in Header */}
      <button
        className={`action-pill host-room-pill ${openToAll ? "open" : "locked"}`}
        onClick={() => setShowSettingsModal(true)}
        title="Host Room Settings (Waiting Room & Open to All)"
        type="button"
      >
        {openToAll ? <Globe size={15} color="#4ade80" /> : <Lock size={15} color="#f59e0b" />}
        <span>{openToAll ? "Open to All" : "Waiting Room ON"}</span>
      </button>

      {/* Host Settings Modal */}
      {showSettingsModal && (
        <div className="profile-modal-backdrop" onClick={() => setShowSettingsModal(false)}>
          <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="profile-modal-header">
              <div className="flex items-center gap-2">
                <Shield size={18} className="text-violet-400" />
                <h3>Host Room Admission Controls</h3>
              </div>
              <button
                className="icon-close"
                onClick={() => setShowSettingsModal(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="host-settings-body">
              <p className="muted small">
                As the meeting host, you control how participants enter room <code>{roomName}</code>.
              </p>

              {/* Setting Option 1: Open to All */}
              <div
                className={`room-policy-card ${openToAll ? "selected" : ""}`}
                onClick={() => handleToggleOpenToAll(true)}
              >
                <div className="policy-icon open">
                  <Globe size={22} />
                </div>
                <div className="policy-content">
                  <div className="policy-title">
                    <b>Open to All</b>
                    {openToAll && <span className="active-tag">Active</span>}
                  </div>
                  <span className="policy-desc">
                    Anyone with the meeting link can join directly without waiting for host permission.
                  </span>
                </div>
              </div>

              {/* Setting Option 2: Waiting Room */}
              <div
                className={`room-policy-card ${!openToAll ? "selected" : ""}`}
                onClick={() => handleToggleOpenToAll(false)}
              >
                <div className="policy-icon locked">
                  <Lock size={22} />
                </div>
                <div className="policy-content">
                  <div className="policy-title">
                    <b>Waiting Room Enabled</b>
                    {!openToAll && <span className="active-tag">Active</span>}
                  </div>
                  <span className="policy-desc">
                    Participants must be approved by the host before entering the meeting.
                  </span>
                </div>
              </div>

              {/* Current Waiting List if any */}
              {waitingList.length > 0 && (
                <div className="waiting-list-section">
                  <div className="waiting-list-header">
                    <span>Currently Waiting ({waitingList.length})</span>
                    <button className="text-btn small" onClick={handleAdmitAll}>
                      Admit All
                    </button>
                  </div>
                  <div className="waiting-list-items">
                    {waitingList.map((p) => (
                      <div key={p.id} className="waiting-user-row">
                        <div className="waiting-user-name">
                          <b>{p.name}</b>
                          <small>{p.email}</small>
                        </div>
                        <div className="waiting-user-btns">
                          <button
                            className="btn-mini admit"
                            onClick={() => handleDecision(p.id, "admit")}
                            title="Admit"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            className="btn-mini reject"
                            onClick={() => handleDecision(p.id, "reject")}
                            title="Reject"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="profile-modal-footer">
                <button
                  type="button"
                  className="button primary"
                  onClick={() => setShowSettingsModal(false)}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
