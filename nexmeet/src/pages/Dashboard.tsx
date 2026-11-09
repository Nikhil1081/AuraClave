import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarDays, Copy, LogOut, Plus, Video, Users, Sparkles, Settings, Camera } from "lucide-react";
import Brand from "../components/Brand";
import LanguageSelector from "../components/LanguageSelector";
import ProfileModal from "../components/ProfileModal";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../contexts/LanguageContext";

function makeRoom() {
  return `aura-${Math.random().toString(36).slice(2, 8)}-${Math.random().toString(36).slice(2, 6)}`;
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const { t } = useLanguage();
  const [roomCode, setRoomCode] = useState("");
  const [_copied, setCopied] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const navigate = useNavigate();
  const fullName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "User";
  const firstName = fullName.split(" ")[0] || "there";
  const avatarUrl = user?.user_metadata?.avatar_url || "";
  const initial = firstName[0]?.toUpperCase() || "U";

  function createMeeting() {
    const room = makeRoom();
    try {
      sessionStorage.setItem(`auraclave_host_${room}`, "true");
    } catch {}
    navigate(`/meeting/${room}`, { state: { isHost: true } });
  }

  const _copyInvite = async () => {
    if (!roomCode.trim()) return;
    await navigator.clipboard.writeText(`${window.location.origin}/meeting/${roomCode.trim()}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <Brand />
        <div className="sidebar-label">WORKSPACE</div>
        <div className="side-item active">
          <Video size={18} /> Meetings
        </div>
        <button
          className="side-item"
          onClick={() => setShowProfileModal(true)}
          style={{ width: "100%", textAlign: "left", background: "none", border: "none" }}
        >
          <Settings size={18} /> Profile & DP
        </button>
        <div className="sidebar-bottom">
          <div className="profile-mini cursor-pointer" onClick={() => setShowProfileModal(true)} title="Edit Profile & DP">
            {avatarUrl ? (
              <img src={avatarUrl} alt={fullName} className="profile-avatar-img" />
            ) : (
              <div className="profile-avatar">{initial}</div>
            )}
            <div className="profile-mini-info">
              <b>{fullName}</b>
              <small>{user?.email}</small>
            </div>
            <Camera size={14} className="profile-mini-edit" />
          </div>
          <button className="side-item logout" onClick={signOut}>
            <LogOut size={17} /> {t("dash_signout")}
          </button>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="dash-top">
          <span className="muted">{t("dash_workspace")}</span>
          <div className="dash-top-right">
            <LanguageSelector compact />
            <span className="online-indicator">
              <i /> Online
            </span>
            <div
              className="profile-avatar-btn cursor-pointer"
              onClick={() => setShowProfileModal(true)}
              title="Edit Profile & DP"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={fullName} className="profile-avatar-img" />
              ) : (
                <div className="profile-avatar">{initial}</div>
              )}
            </div>
          </div>
        </header>

        <section className="welcome-row">
          <div>
            <div className="eyebrow">YOUR MEETING SPACE</div>
            <h1>
              {t("dash_welcome")}, {firstName}.
            </h1>
            <p className="muted">Make space for a great conversation today.</p>
          </div>
          <div className="date-chip">
            <CalendarDays size={17} />
            {new Date().toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric"
            })}
          </div>
        </section>

        <section className="meeting-actions">
          <article className="action-card create-card">
            <div className="action-icon">
              <Plus size={21} />
            </div>
            <div className="eyebrow">START SOMETHING</div>
            <h2>{t("dash_start_instant")}</h2>
            <p>{t("dash_start_desc")}</p>
            <button className="button primary" onClick={createMeeting}>
              {t("dash_create_btn")} <ArrowRight size={17} />
            </button>
            <div className="card-decoration">
              <Video size={94} />
            </div>
          </article>

          <article className="action-card join-card">
            <div className="action-icon join-icon">
              <Users size={21} />
            </div>
            <div className="eyebrow">JOIN YOUR TEAM</div>
            <h2>{t("dash_have_code")}</h2>
            <p>Enter the room code or meeting ID shared with you.</p>
            <div className="join-input">
              <input
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                placeholder={t("dash_code_placeholder")}
                onKeyDown={(e) =>
                  e.key === "Enter" && roomCode.trim() && navigate(`/meeting/${roomCode.trim()}`)
                }
              />
              <button
                className="button primary"
                disabled={!roomCode.trim()}
                onClick={() => navigate(`/meeting/${roomCode.trim()}`)}
              >
                {t("dash_join_btn")} <ArrowRight size={16} />
              </button>
            </div>
          </article>
        </section>

        <section className="dash-lower">
          <div className="section-title">
            <div>
              <h2>{t("dash_quick_invite")}</h2>
              <p className="muted">{t("dash_invite_desc")}</p>
            </div>
            <span className="subtle-tag">
              <Sparkles size={14} /> Easy collaboration
            </span>
          </div>
          <div className="invite-box">
            <div className="invite-symbol">
              <Copy size={20} />
            </div>
            <div className="invite-text">
              <b>Share a room link</b>
              <span>
                Create a meeting first, then copy its URL from the browser address bar to invite
                others.
              </span>
            </div>
            <button className="button secondary" onClick={createMeeting}>
              Create invite <ArrowRight size={16} />
            </button>
          </div>
          <div className="notice info-notice">
            Tip: Your meeting link works for anyone who has access to it and an AuraClave account.
            Keep private meeting links within your intended group.
          </div>
        </section>
      </main>

      <ProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
      />
    </div>
  );
}
