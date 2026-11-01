import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarDays, Copy, LogOut, Plus, Video, Users, Sparkles } from "lucide-react";
import Brand from "../components/Brand";
import { useAuth } from "../contexts/AuthContext";

function makeRoom() { return `nex-${Math.random().toString(36).slice(2, 8)}-${Math.random().toString(36).slice(2, 6)}`; }

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const [roomCode, setRoomCode] = useState("");
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();
  const firstName = user?.user_metadata?.full_name?.split(" ")[0] || user?.email?.split("@")[0] || "there";

  function createMeeting() { navigate(`/meeting/${makeRoom()}`); }
  async function copyInvite() {
    if (!roomCode.trim()) return;
    await navigator.clipboard.writeText(`${window.location.origin}/meeting/${roomCode.trim()}`);
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  }
  return <div className="dashboard-shell"><aside className="sidebar"><Brand/><div className="sidebar-label">WORKSPACE</div><div className="side-item active"><Video size={18}/> Meetings</div><div className="sidebar-bottom"><div className="profile-mini"><div className="profile-avatar">{firstName[0]?.toUpperCase()}</div><div><b>{firstName}</b><small>{user?.email}</small></div></div><button className="side-item logout" onClick={signOut}><LogOut size={17}/> Sign out</button></div></aside><main className="dashboard-main"><header className="dash-top"><span className="muted">Workspace / Meetings</span><div className="dash-top-right"><span className="online-indicator"><i/> Online</span><div className="profile-avatar">{firstName[0]?.toUpperCase()}</div></div></header><section className="welcome-row"><div><div className="eyebrow">YOUR MEETING SPACE</div><h1>Good to see you, {firstName}.</h1><p className="muted">Make space for a great conversation today.</p></div><div className="date-chip"><CalendarDays size={17}/>{new Date().toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"})}</div></section><section className="meeting-actions"><article className="action-card create-card"><div className="action-icon"><Plus size={21}/></div><div className="eyebrow">START SOMETHING</div><h2>Start an instant meeting</h2><p>Create a room and invite your team in seconds.</p><button className="button primary" onClick={createMeeting}>Create meeting <ArrowRight size={17}/></button><div className="card-decoration"><Video size={94}/></div></article><article className="action-card join-card"><div className="action-icon join-icon"><Users size={21}/></div><div className="eyebrow">JOIN YOUR TEAM</div><h2>Have a meeting code?</h2><p>Enter the room code or meeting ID shared with you.</p><div className="join-input"><input value={roomCode} onChange={e=>setRoomCode(e.target.value)} placeholder="Enter meeting code" onKeyDown={e=>e.key==="Enter" && roomCode.trim() && navigate(`/meeting/${roomCode.trim()}`)}/><button className="button primary" disabled={!roomCode.trim()} onClick={()=>navigate(`/meeting/${roomCode.trim()}`)}>Join <ArrowRight size={16}/></button></div></article></section><section className="dash-lower"><div className="section-title"><div><h2>Quick invite</h2><p className="muted">Share a meeting link with anyone on your team.</p></div><span className="subtle-tag"><Sparkles size={14}/> Easy collaboration</span></div><div className="invite-box"><div className="invite-symbol"><Copy size={20}/></div><div className="invite-text"><b>Share a room link</b><span>Create a meeting first, then copy its URL from the browser address bar to invite others.</span></div><button className="button secondary" onClick={createMeeting}>Create invite <ArrowRight size={16}/></button></div><div className="notice info-notice">Tip: Your meeting link works for anyone who has access to it and an AuraClave account. Keep private meeting links within your intended group.</div></section></main></div>;
}