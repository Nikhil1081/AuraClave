import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  PhoneOff,
  Share2,
  Sparkles,
  Subtitles,
  CircleDot,
  Square,
  Copy,
  Check,
  LoaderCircle,
  X,
  Hand,
  Users,
  Radio,
  ArrowUpRight,
  ArrowDownLeft,
  UserCheck
} from "lucide-react";
import Brand from "./Brand";
import ShareMeetingModal from "./ShareMeetingModal";
import HostAdmissionBanner from "./HostAdmissionBanner";
import LanguageSelector from "./LanguageSelector";
import { useAuraWeave, type AuraWeavePeer } from "../lib/auraweave";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../contexts/LanguageContext";
import { getApiBase } from "../lib/auth";

export default function AuraWeaveConference({
  roomName,
  isHost
}: {
  roomName: string;
  isHost: boolean;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { language, t, currentSpeechCode } = useLanguage();

  const [showShareModal, setShowShareModal] = useState(false);
  const [quickCopied, setQuickCopied] = useState(false);
  const [showHandsModal, setShowHandsModal] = useState(false);

  // AuraWeave 1,000-Participant Engine Hook
  const {
    role,
    isStageMember,
    localStream,
    peers,
    audienceCount,
    totalParticipants,
    handsRaised,
    myHandRaised,
    isAudioMuted,
    isVideoMuted,
    isScreenSharing,
    connected,
    error: rtcError,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    toggleRaiseHand,
    promoteToStage,
    demoteToAudience,
    broadcastCaption,
    setOnCaptionReceived
  } = useAuraWeave({
    roomName,
    user: user
      ? {
          id: user.id,
          name: user.user_metadata?.full_name || user.email || "You",
          avatarUrl: user.user_metadata?.avatar_url || ""
        }
      : null,
    isHost
  });

  // Local Video Ref
  const localVideoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Captions state
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [currentCaption, setCurrentCaption] = useState<{ speaker: string; text: string } | null>(null);
  const [transcript, setTranscript] = useState<{ speaker: string; text: string; time: string }[]>([]);
  const recognitionRef = useRef<any>(null);
  const captionTimeoutRef = useRef<any>(null);

  // Setup broadcasted captions listener
  useEffect(() => {
    setOnCaptionReceived((speaker, text) => {
      setCurrentCaption({ speaker, text });
      if (captionTimeoutRef.current) clearTimeout(captionTimeoutRef.current);
      captionTimeoutRef.current = setTimeout(() => setCurrentCaption(null), 4000);

      setTranscript((prev) => [
        ...prev,
        {
          speaker,
          text,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        }
      ]);
    });
  }, []);

  // Web Speech Recognition for Stage Members
  useEffect(() => {
    if (!captionsEnabled || !isStageMember) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
        recognitionRef.current = null;
      }
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setCaptionsEnabled(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = currentSpeechCode;

    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      const text = (final || interim).trim();
      if (!text) return;

      const myName = user?.user_metadata?.full_name || user?.email || "Speaker";
      setCurrentCaption({ speaker: myName, text });

      if (captionTimeoutRef.current) clearTimeout(captionTimeoutRef.current);
      captionTimeoutRef.current = setTimeout(() => setCurrentCaption(null), 4000);

      if (final.trim()) {
        broadcastCaption(myName, final.trim());
        setTranscript((prev) => [
          ...prev,
          {
            speaker: myName,
            text: final.trim(),
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          }
        ]);
      }
    };

    recognition.onerror = () => {};
    recognition.onend = () => {
      if (captionsEnabled && isStageMember) {
        try {
          recognition.start();
        } catch {}
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch {}

    return () => {
      try {
        recognition.stop();
      } catch {}
    };
  }, [captionsEnabled, currentSpeechCode, isStageMember, user]);

  // Zero-Prompt Recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordIntervalRef = useRef<any>(null);

  const toggleRecording = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      clearInterval(recordIntervalRef.current);
      setIsRecording(false);
      setRecordingSeconds(0);
    } else {
      try {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioCtxClass();
        const dest = audioCtx.createMediaStreamDestination();

        if (localStream && localStream.getAudioTracks().length > 0) {
          const micSource = audioCtx.createMediaStreamSource(localStream);
          micSource.connect(dest);
        }

        peers.forEach((p) => {
          if (p.stream && p.stream.getAudioTracks().length > 0) {
            try {
              const peerSource = audioCtx.createMediaStreamSource(p.stream);
              peerSource.connect(dest);
            } catch {}
          }
        });

        let videoTrack: MediaStreamTrack | null = null;
        if (localStream && localStream.getVideoTracks().length > 0) {
          videoTrack = localStream.getVideoTracks()[0];
        } else if (peers.length > 0 && peers[0].stream?.getVideoTracks().length) {
          videoTrack = peers[0].stream.getVideoTracks()[0];
        }

        const combinedStream = videoTrack
          ? new MediaStream([videoTrack, ...dest.stream.getAudioTracks()])
          : dest.stream;

        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
          ? "video/webm;codecs=vp9,opus"
          : "video/webm";

        const recorder = new MediaRecorder(combinedStream, { mimeType });
        recordedChunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            recordedChunksRef.current.push(e.data);
          }
        };

        recorder.onstop = () => {
          const blob = new Blob(recordedChunksRef.current, { type: mimeType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.style.display = "none";
          a.href = url;
          a.download = `AuraClave-${roomName}-${new Date().toISOString().slice(0, 10)}.webm`;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
          }, 200);
        };

        recorder.start(1000);
        mediaRecorderRef.current = recorder;
        setIsRecording(true);
        setRecordingSeconds(0);

        recordIntervalRef.current = setInterval(() => {
          setRecordingSeconds((prev) => prev + 1);
        }, 1000);
      } catch (err) {
        console.error("Recording error:", err);
        alert("Recording error: " + (err as Error).message);
      }
    }
  };

  // AI Notes Generation
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiCopied, setAiCopied] = useState(false);

  const handleGenerateAiNotes = async () => {
    setShowAiModal(true);
    setAiLoading(true);
    setAiError("");

    const notesText =
      transcript.length > 0
        ? transcript.map((t) => `${t.speaker} [${t.time}]: ${t.text}`).join("\n")
        : `Meeting in room ${roomName} with ${totalParticipants} total attendees. Presenters and host leading discussion.`;

    try {
      const base = getApiBase();
      const url = base ? `${base}/api/ai` : "/api/ai";
      const token = localStorage.getItem("auraclave_auth_token") || "";

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: notesText, task: "summarize" })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate AI notes.");
      setAiSummary(data.result || "No notes generated.");
    } catch (err: any) {
      setAiError(err?.message || "Could not generate AI notes.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleLeave = () => {
    navigate("/dashboard");
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const myName = user?.user_metadata?.full_name || user?.email || "You";
  const myAvatar = user?.user_metadata?.avatar_url || "";
  const myInitial = (myName.trim() || "U")[0].toUpperCase();

  const stageMembersCount = (isStageMember ? 1 : 0) + peers.length;
  const gridClass =
    stageMembersCount <= 1
      ? "grid-1"
      : stageMembersCount === 2
      ? "grid-2"
      : stageMembersCount <= 4
      ? "grid-4"
      : "grid-multi";

  return (
    <div className="meeting-page">
      {/* Header */}
      <header className="meeting-header">
        <Link to="/dashboard" className="meeting-brand">
          <Brand small />
          <span className="meeting-divider" />
          <span className="meeting-room-label">Meeting room</span>
        </Link>

        <div className="meeting-header-actions">
          {/* AuraWeave 1,000 Capacity Badge */}
          <div className="auraweave-badge" title="AuraWeave RTC™ 1,000 Capacity Stage & Audience Mesh">
            <Radio size={13} className="text-emerald-400 animate-pulse" />
            <span>AuraWeave 1K Stage</span>
          </div>

          {/* Live Audience Counter */}
          <div className="audience-pill" title={`${totalParticipants} total participants in this call`}>
            <Users size={13} />
            <span>{totalParticipants} Live ({audienceCount} Audience)</span>
          </div>

          {/* Hands Raised Indicator for Host */}
          {role === "host" && handsRaised.length > 0 && (
            <button
              type="button"
              className="hands-raised-indicator-btn"
              onClick={() => setShowHandsModal(true)}
              title={`${handsRaised.length} audience member(s) raised hand`}
            >
              <Hand size={14} className="hand-bounce" />
              <span>{handsRaised.length} Raised</span>
            </button>
          )}

          <div className="meeting-room-id">
            <span className="status-dot" /> {roomName}
          </div>

          {isHost && <HostAdmissionBanner roomName={roomName} />}

          <button
            className={`meeting-share-pill ${quickCopied ? "copied" : ""}`}
            onClick={() => setShowShareModal(true)}
            type="button"
          >
            <Share2 size={14} />
            <span>{quickCopied ? "Link Copied!" : "Share Link"}</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="meeting-content">
        {/* Audience Status Notification Banner */}
        {!isStageMember && (
          <div className="audience-status-banner">
            <div className="flex items-center gap-2">
              <span className="live-dot" />
              <span>
                You are currently in the <strong>Audience</strong> (watching in HD). Click <strong>Raise Hand</strong> below to speak on stage.
              </span>
            </div>
            {myHandRaised && (
              <span className="hand-raised-badge">
                <Hand size={13} /> Hand Raised — Waiting for Host
              </span>
            )}
          </div>
        )}

        {/* Stage Video Grid */}
        <div className={`auraweave-grid ${gridClass}`}>
          {/* Local Tile (if on Stage) */}
          {isStageMember && (
            <div className="auraweave-tile local-tile">
              {!isVideoMuted && localStream ? (
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`tile-video ${isScreenSharing ? "screen" : "mirrored"}`}
                />
              ) : (
                <div className="tile-placeholder">
                  {myAvatar ? (
                    <img src={myAvatar} alt={myName} className="tile-avatar-img" />
                  ) : (
                    <div className="tile-avatar-fallback">{myInitial}</div>
                  )}
                </div>
              )}

              <div className="tile-meta">
                <span className="tile-name">{myName} (You • {role === "host" ? "Host" : "Presenter"})</span>
                {isAudioMuted ? (
                  <MicOff size={14} className="tile-muted-icon" />
                ) : (
                  <Mic size={14} className="tile-mic-icon" />
                )}
              </div>

              {isScreenSharing && <div className="tile-screen-badge">Presenting Screen</div>}
            </div>
          )}

          {/* Remote Stage Peers */}
          {peers.map((peer) => (
            <RemoteStagePeerTile
              key={peer.peerId}
              peer={peer}
              isHost={role === "host"}
              onDemote={() => demoteToAudience(peer.peerId)}
            />
          ))}

          {/* Empty Stage Placeholder if Audience with no Active Presenter */}
          {!isStageMember && peers.length === 0 && (
            <div className="empty-stage-box">
              <Radio size={36} className="text-violet-400 mb-2" />
              <h3>The Stage is Ready</h3>
              <p className="text-slate-400 text-sm">Host and presenters will appear here when they share video or screen.</p>
            </div>
          )}
        </div>

        {/* Live Closed Captions */}
        {captionsEnabled && currentCaption && (
          <div className="live-caption-pill">
            <span className="caption-speaker">{currentCaption.speaker}:</span>
            <span className="caption-text">{currentCaption.text}</span>
          </div>
        )}
      </div>

      {/* Floating Bottom Controls */}
      <footer className="meeting-footer">
        <div className="meeting-controls-wrap">
          {/* Stage Controls */}
          {isStageMember ? (
            <>
              <button
                type="button"
                className={`control-btn ${isAudioMuted ? "danger" : "active"}`}
                onClick={toggleAudio}
                title={isAudioMuted ? "Unmute microphone" : "Mute microphone"}
              >
                {isAudioMuted ? <MicOff size={18} /> : <Mic size={18} />}
                <span>{isAudioMuted ? "Unmute" : "Mute"}</span>
              </button>

              <button
                type="button"
                className={`control-btn ${isVideoMuted ? "danger" : "active"}`}
                onClick={toggleVideo}
                title={isVideoMuted ? "Start camera" : "Stop camera"}
              >
                {isVideoMuted ? <VideoOff size={18} /> : <Video size={18} />}
                <span>{isVideoMuted ? "Start Cam" : "Stop Cam"}</span>
              </button>

              <button
                type="button"
                className={`control-btn ${isScreenSharing ? "accent" : ""}`}
                onClick={toggleScreenShare}
                title="Share Screen to all 1,000 attendees"
              >
                <Monitor size={18} />
                <span>{isScreenSharing ? "Stop Sharing" : "Share Screen"}</span>
              </button>
            </>
          ) : (
            /* Audience Raise Hand Control */
            <button
              type="button"
              className={`control-btn ${myHandRaised ? "hand-raised-glow" : "accent"}`}
              onClick={toggleRaiseHand}
              title={myHandRaised ? "Lower your hand" : "Raise hand to request speaking on stage"}
            >
              <Hand size={18} className={myHandRaised ? "animate-bounce" : ""} />
              <span>{myHandRaised ? "Lower Hand" : "Raise Hand"}</span>
            </button>
          )}

          {/* Universal Controls */}
          <LanguageSelector compact />

          <button
            type="button"
            className={`control-btn ${captionsEnabled ? "accent" : ""}`}
            onClick={() => setCaptionsEnabled(!captionsEnabled)}
            title="Live Closed Captions"
          >
            <Subtitles size={18} />
            <span>CC</span>
          </button>

          <button
            type="button"
            className={`control-btn ${isRecording ? "danger recording-pulse" : ""}`}
            onClick={toggleRecording}
            title="Meeting Recorder (Zero Prompt)"
          >
            {isRecording ? <Square size={16} /> : <CircleDot size={18} />}
            <span>{isRecording ? `Rec ${formatTime(recordingSeconds)}` : "Record"}</span>
          </button>

          <button
            type="button"
            className="control-btn ai-btn"
            onClick={handleGenerateAiNotes}
            title="Generate AI Meeting Minutes"
          >
            <Sparkles size={18} />
            <span>AI Notes</span>
          </button>

          <button
            type="button"
            className="control-btn leave-btn"
            onClick={handleLeave}
            title="Leave meeting"
          >
            <PhoneOff size={18} />
            <span>Leave</span>
          </button>
        </div>
      </footer>

      {/* Share Modal */}
      <ShareMeetingModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        roomName={roomName}
      />

      {/* Host Hands Raised Management Modal */}
      {showHandsModal && (
        <div className="ai-modal-backdrop" onClick={() => setShowHandsModal(false)}>
          <div className="ai-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ai-modal-header">
              <div className="flex items-center gap-2">
                <Hand size={18} className="text-violet-400" />
                <h3>Raised Hands ({handsRaised.length})</h3>
              </div>
              <button className="icon-close" onClick={() => setShowHandsModal(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="ai-modal-body">
              {handsRaised.length === 0 ? (
                <p className="text-slate-400 text-sm">No audience members currently have their hand raised.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {handsRaised.map((h) => (
                    <div key={h.peerId} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/10">
                      <div className="flex items-center gap-3">
                        {h.avatarUrl ? (
                          <img src={h.avatarUrl} alt={h.name} className="w-9 h-9 rounded-full object-cover" />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-violet-600 flex items-center justify-center font-bold text-white">
                            {(h.name || "U")[0].toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div className="font-semibold text-sm text-white">{h.name}</div>
                          <div className="text-xs text-slate-400">Audience member requested to speak</div>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="button primary small flex items-center gap-1.5"
                        onClick={() => {
                          promoteToStage(h.peerId);
                          setShowHandsModal(false);
                        }}
                      >
                        <ArrowUpRight size={14} /> Bring to Stage
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="ai-modal-footer">
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowHandsModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Summary Modal */}
      {showAiModal && (
        <div className="ai-modal-backdrop" onClick={() => setShowAiModal(false)}>
          <div className="ai-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ai-modal-header">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-violet-400" />
                <h3>AuraClave AI Meeting Summary</h3>
              </div>
              <button className="icon-close" onClick={() => setShowAiModal(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="ai-modal-body">
              {aiLoading ? (
                <div className="ai-loading-state">
                  <LoaderCircle className="spin" size={28} />
                  <p>Synthesizing 1,000-participant meeting minutes with Llama 3.3…</p>
                </div>
              ) : aiError ? (
                <div className="notice error">{aiError}</div>
              ) : (
                <div className="ai-summary-text">{aiSummary}</div>
              )}
            </div>

            <div className="ai-modal-footer">
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowAiModal(false)}
              >
                Close
              </button>
              {aiSummary && (
                <button
                  type="button"
                  className="button primary"
                  onClick={() => {
                    navigator.clipboard.writeText(aiSummary);
                    setAiCopied(true);
                    setTimeout(() => setAiCopied(false), 2000);
                  }}
                >
                  {aiCopied ? <Check size={16} /> : <Copy size={16} />}
                  <span>{aiCopied ? "Copied" : "Copy Notes"}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Remote Stage Presenter Tile
function RemoteStagePeerTile({
  peer,
  isHost,
  onDemote
}: {
  peer: AuraWeavePeer;
  isHost: boolean;
  onDemote: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && peer.stream) {
      videoRef.current.srcObject = peer.stream;
    }
  }, [peer.stream]);

  const initial = (peer.name.trim() || "P")[0].toUpperCase();

  return (
    <div className="auraweave-tile remote-tile">
      {peer.stream && !peer.isVideoMuted ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className={`tile-video ${peer.isScreenSharing ? "screen" : ""}`}
        />
      ) : (
        <div className="tile-placeholder">
          {peer.avatarUrl ? (
            <img src={peer.avatarUrl} alt={peer.name} className="tile-avatar-img" />
          ) : (
            <div className="tile-avatar-fallback">{initial}</div>
          )}
        </div>
      )}

      <div className="tile-meta">
        <span className="tile-name">{peer.name} ({peer.role === "host" ? "Host" : "Presenter"})</span>
        {peer.isAudioMuted ? (
          <MicOff size={14} className="tile-muted-icon" />
        ) : (
          <Mic size={14} className="tile-mic-icon" />
        )}
      </div>

      {peer.isScreenSharing && <div className="tile-screen-badge">Presenting Screen</div>}

      {/* Host Demote Button */}
      {isHost && peer.role === "presenter" && (
        <button
          type="button"
          className="tile-demote-btn"
          onClick={onDemote}
          title="Return presenter to audience"
        >
          <ArrowDownLeft size={12} />
          <span>Move to Audience</span>
        </button>
      )}
    </div>
  );
}
