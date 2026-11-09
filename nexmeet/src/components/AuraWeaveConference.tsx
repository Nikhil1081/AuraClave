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
  Download,
  LoaderCircle,
  X,
  ShieldCheck
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

  // AuraWeave RTC Engine Hook
  const {
    localStream,
    peers,
    isAudioMuted,
    isVideoMuted,
    isScreenSharing,
    connected,
    error: rtcError,
    toggleAudio,
    toggleVideo,
    toggleScreenShare
  } = useAuraWeave({
    roomName,
    user: user
      ? {
          id: user.id,
          name: user.user_metadata?.full_name || user.email || "You",
          avatarUrl: user.user_metadata?.avatar_url || ""
        }
      : null
  });

  // Local Video Ref
  const localVideoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Captions state (Web Speech API)
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [currentCaption, setCurrentCaption] = useState<{ speaker: string; text: string } | null>(null);
  const [transcript, setTranscript] = useState<{ speaker: string; text: string; time: string }[]>([]);
  const recognitionRef = useRef<any>(null);
  const captionTimeoutRef = useRef<any>(null);

  // Recording state (Zero-Prompt Web Audio + MediaRecorder)
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordIntervalRef = useRef<any>(null);

  // AI Notes state
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiCopied, setAiCopied] = useState(false);

  // 1. Live Captions via SpeechRecognition
  useEffect(() => {
    if (!captionsEnabled) {
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
      alert("Live captions: Speech recognition is not supported in this browser. Please use Google Chrome or Edge.");
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

      const myName = user?.user_metadata?.full_name || user?.email || "You";
      setCurrentCaption({ speaker: myName, text });

      if (captionTimeoutRef.current) clearTimeout(captionTimeoutRef.current);
      captionTimeoutRef.current = setTimeout(() => setCurrentCaption(null), 4000);

      if (final.trim()) {
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
      if (captionsEnabled) {
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
  }, [captionsEnabled, currentSpeechCode, user]);

  // 2. Zero-Prompt Recording via Web Audio API + MediaRecorder
  const toggleRecording = async () => {
    if (isRecording) {
      // Stop recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      clearInterval(recordIntervalRef.current);
      setIsRecording(false);
      setRecordingSeconds(0);
    } else {
      // Start recording
      try {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioCtxClass();
        const dest = audioCtx.createMediaStreamDestination();

        // Add local mic
        if (localStream && localStream.getAudioTracks().length > 0) {
          const micSource = audioCtx.createMediaStreamSource(localStream);
          micSource.connect(dest);
        }

        // Add peer audio streams
        peers.forEach((p) => {
          if (p.stream && p.stream.getAudioTracks().length > 0) {
            try {
              const peerSource = audioCtx.createMediaStreamSource(p.stream);
              peerSource.connect(dest);
            } catch {}
          }
        });

        // Determine video track to record (screen share or local video)
        let videoTrack: MediaStreamTrack | null = null;
        if (localStream && localStream.getVideoTracks().length > 0) {
          videoTrack = localStream.getVideoTracks()[0];
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
        alert("Could not start recording: " + (err as Error).message);
      }
    }
  };

  // 3. AI Notes Generation with Groq
  const handleGenerateAiNotes = async () => {
    setShowAiModal(true);
    setAiLoading(true);
    setAiError("");

    const notesText =
      transcript.length > 0
        ? transcript.map((t) => `${t.speaker} [${t.time}]: ${t.text}`).join("\n")
        : `Meeting in room ${roomName} with ${peers.length + 1} participants. Topics discussed include ongoing project planning, roadmap reviews, and deliverables.`;

    try {
      const base = getApiBase();
      const url = base ? `${base}/api/ai` : "/api/ai";
      const token = localStorage.getItem("auraclave_auth_token") || "";

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
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

  const totalParticipants = 1 + peers.length;
  const gridClass =
    totalParticipants === 1
      ? "grid-1"
      : totalParticipants === 2
      ? "grid-2"
      : totalParticipants <= 4
      ? "grid-4"
      : "grid-multi";

  return (
    <div className="meeting-page">
      {/* Top Header */}
      <header className="meeting-header">
        <Link to="/dashboard" className="meeting-brand">
          <Brand small />
          <span className="meeting-divider" />
          <span className="meeting-room-label">Meeting room</span>
        </Link>

        <div className="meeting-header-actions">
          {/* AuraWeave Brand Indicator */}
          <div className="auraweave-badge" title="Powered by 100% Free AuraWeave Peer-to-Peer Mesh">
            <span className="auraweave-dot" />
            <span>AuraWeave RTC™</span>
          </div>

          <div className="meeting-room-id">
            <span className="status-dot" /> {roomName}
          </div>

          {/* Host Admission Pill */}
          {isHost && <HostAdmissionBanner roomName={roomName} />}

          {/* Share Pill */}
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

      {/* Main Video Conference Grid */}
      <div className="meeting-content">
        <div className={`auraweave-grid ${gridClass}`}>
          {/* 1. Local Participant Tile */}
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
              <span className="tile-name">{myName} (You)</span>
              {isAudioMuted ? (
                <MicOff size={14} className="tile-muted-icon" />
              ) : (
                <Mic size={14} className="tile-mic-icon" />
              )}
            </div>

            {isScreenSharing && <div className="tile-screen-badge">Presenting</div>}
          </div>

          {/* 2. Remote Participant Tiles */}
          {peers.map((peer) => (
            <RemotePeerTile key={peer.peerId} peer={peer} />
          ))}
        </div>

        {/* Live Closed Captions Overlay */}
        {captionsEnabled && currentCaption && (
          <div className="live-caption-pill">
            <span className="caption-speaker">{currentCaption.speaker}:</span>
            <span className="caption-text">{currentCaption.text}</span>
          </div>
        )}
      </div>

      {/* Bottom Meeting Controls Bar */}
      <footer className="meeting-footer">
        <div className="meeting-controls-wrap">
          {/* Mic Button */}
          <button
            type="button"
            className={`control-btn ${isAudioMuted ? "danger" : "active"}`}
            onClick={toggleAudio}
            title={isAudioMuted ? "Unmute microphone" : "Mute microphone"}
          >
            {isAudioMuted ? <MicOff size={18} /> : <Mic size={18} />}
            <span>{isAudioMuted ? "Unmute" : "Mute"}</span>
          </button>

          {/* Camera Button */}
          <button
            type="button"
            className={`control-btn ${isVideoMuted ? "danger" : "active"}`}
            onClick={toggleVideo}
            title={isVideoMuted ? "Start camera" : "Stop camera"}
          >
            {isVideoMuted ? <VideoOff size={18} /> : <Video size={18} />}
            <span>{isVideoMuted ? "Start Cam" : "Stop Cam"}</span>
          </button>

          {/* Screen Share Button */}
          <button
            type="button"
            className={`control-btn ${isScreenSharing ? "accent" : ""}`}
            onClick={toggleScreenShare}
            title={isScreenSharing ? "Stop sharing screen" : "Share screen"}
          >
            <Monitor size={18} />
            <span>{isScreenSharing ? "Stop Sharing" : "Share Screen"}</span>
          </button>

          {/* Language Selector */}
          <LanguageSelector compact />

          {/* Live Captions (CC) */}
          <button
            type="button"
            className={`control-btn ${captionsEnabled ? "accent" : ""}`}
            onClick={() => setCaptionsEnabled(!captionsEnabled)}
            title="Live Closed Captions"
          >
            <Subtitles size={18} />
            <span>CC</span>
          </button>

          {/* Zero-Prompt Recorder */}
          <button
            type="button"
            className={`control-btn ${isRecording ? "danger recording-pulse" : ""}`}
            onClick={toggleRecording}
            title="Meeting Recorder (Zero Prompt)"
          >
            {isRecording ? <Square size={16} /> : <CircleDot size={18} />}
            <span>{isRecording ? `Rec ${formatTime(recordingSeconds)}` : "Record"}</span>
          </button>

          {/* AI Notes */}
          <button
            type="button"
            className="control-btn ai-btn"
            onClick={handleGenerateAiNotes}
            title="Generate AI Meeting Minutes"
          >
            <Sparkles size={18} />
            <span>AI Notes</span>
          </button>

          {/* Leave Button */}
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
                  <p>Synthesizing meeting transcript into actionable notes with Llama 3.3…</p>
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

// Remote Peer Video Tile Sub-component
function RemotePeerTile({ peer }: { peer: AuraWeavePeer }) {
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
        <span className="tile-name">{peer.name}</span>
        {peer.isAudioMuted ? (
          <MicOff size={14} className="tile-muted-icon" />
        ) : (
          <Mic size={14} className="tile-mic-icon" />
        )}
      </div>

      {peer.isScreenSharing && <div className="tile-screen-badge">Presenting</div>}
    </div>
  );
}
