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
  Users,
  Radio,
  UserCheck,
  MessageSquare,
  Send,
  Hand,
  Smile
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

  // In-Meeting Real-Time Chat State
  const [showChat, setShowChat] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [chatInput, setChatInput] = useState("");
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // AuraWeave 1,000-Participant Engine Hook
  const {
    myPeerId,
    isStageMember,
    localStream,
    peers,
    totalParticipants,
    isAudioMuted,
    isVideoMuted,
    isScreenSharing,
    chatMessages,
    sendChatMessage,
    connected,
    error: rtcError,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    toggleRaiseHand,
    myHandRaised,
    sendReaction,
    reactions,
    broadcastCaption,
    setOnCaptionReceived,
    networkLevel
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

  // Global Audio Autoplay Policy Unblocker
  useEffect(() => {
    const unlockAudio = () => {
      document.querySelectorAll("audio").forEach((el) => {
        el.play().catch(() => {});
      });
    };
    window.addEventListener("click", unlockAudio);
    window.addEventListener("touchstart", unlockAudio);
    return () => {
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
    };
  }, []);

  // Track chat messages & auto-scroll
  useEffect(() => {
    if (chatMessages.length > 0) {
      const last = chatMessages[chatMessages.length - 1];
      if (!showChat && !last.isSelf) {
        setUnreadChatCount((prev) => prev + 1);
      }
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, showChat]);

  const handleSendChat = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim()) return;
    sendChatMessage(chatInput.trim());
    setChatInput("");
  };

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

  // Web Speech Recognition for meeting participants
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

    const transcriptText = transcript
      .map((entry) => `[Transcript] ${entry.speaker} [${entry.time}]: ${entry.text}`)
      .join("\n");
    const chatText = chatMessages
      .map((message) => `[Chat] ${message.senderName} [${message.time}]: ${message.text}`)
      .join("\n");
    const notesText = [transcriptText, chatText].filter(Boolean).join("\n") ||
      `Meeting in room ${roomName} with ${totalParticipants} participants.`;

    try {
      const base = getApiBase();
      const url = base ? `${base}/api/ai` : "/api/ai";
      const token = localStorage.getItem("auraclave_auth_token") || "";

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          text: notesText.slice(-20000),
          task: "summarize"
        })
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

  const downloadMeetingTranscript = () => {
    const transcriptText = transcript
      .map((entry) => `[Transcript] ${entry.speaker} [${entry.time}]: ${entry.text}`)
      .join("\n");
    const chatText = chatMessages
      .map((message) => `[Chat] ${message.senderName} [${message.time}]: ${message.text}`)
      .join("\n");
    const content = [
      `AuraClave meeting: ${roomName}`,
      `Exported: ${new Date().toLocaleString()}`,
      "",
      transcriptText || "No live transcript was captured.",
      chatText ? `\n${chatText}` : "\nNo chat messages were captured."
    ].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `AuraClave-${roomName}-transcript.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
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

  const remotePeers = peers
    .filter(
      (peer) =>
        peer.peerId !== myPeerId &&
        (!user?.id || peer.userId !== user.id) &&
        (!myName || peer.name !== myName)
    );

  const hasScreenShare = isScreenSharing || remotePeers.some(p => p.isScreenSharing);
  const screenSharePeer = hasScreenShare
    ? isScreenSharing
      ? { isLocal: true }
      : remotePeers.find(p => p.isScreenSharing)
    : null;

  // Layout selection: screen share gets large main + sidebar, focus mode for few participants
  const gridClass =
    // Screen share layout: large main tile + sidebar for others
    hasScreenShare && (remotePeers.length >= 2 || (remotePeers.length >= 1 && !isScreenSharing))
      ? "layout-screen-share"
    // Focus mode: speaker view with small sidebar for 1-3 remote participants
    : remotePeers.length >= 1 && remotePeers.length <= 3
      ? "layout-focus"
      : // Standard grid layouts
      (() => {
          const count = 1 + peers.length;
          if (count <= 1) return "grid-1";
          if (count === 2) return "grid-2";
          if (count <= 4) return "grid-4";
          return "grid-multi";
        })();

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
          {/* Meeting status */}
          <div className="auraweave-badge" title="AuraWeave RTC™ meeting">
            <Radio size={13} className="text-emerald-400 animate-pulse" />
            <span>AuraWeave Meeting</span>
          </div>

          <div className="audience-pill" title={`${totalParticipants} total participants in this call`}>
            <Users size={13} />
            <span>{totalParticipants} Participants</span>
          </div>

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

          <button
            type="button"
            className={`control-btn ${myHandRaised ? "accent" : ""}`}
            onClick={toggleRaiseHand}
            title={myHandRaised ? "Lower hand" : "Raise hand"}
          >
            <Hand size={18} />
            <span>{myHandRaised ? "Lower hand" : "Raise hand"}</span>
          </button>

          <div className="reaction-picker-wrap">
            <button
              type="button"
              className={`control-btn ${showReactions ? "accent" : ""}`}
              onClick={() => setShowReactions((visible) => !visible)}
              title="Send reaction"
              aria-label="Send reaction"
            >
              <Smile size={18} />
              <span>Reactions</span>
            </button>
            {showReactions && (
              <div className="reaction-picker">
                {["👍", "👏", "😂", "❤️", "🎉", "💡"].map((emoji) => (
                  <button
                    type="button"
                    key={emoji}
                    onClick={() => {
                      void sendReaction(emoji);
                      setShowReactions(false);
                    }}
                    aria-label={`Send ${emoji} reaction`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className={`meeting-content ${showChat ? "with-chat" : ""}`}>
        <div className="meeting-stage-area">
          {reactions.length > 0 && (
            <div className="meeting-reactions" aria-live="polite">
              {reactions.map((reaction) => (
                <span key={reaction.id} className="meeting-reaction" title={reaction.name}>
                  {reaction.emoji}
                </span>
              ))}
            </div>
          )}
          {/* Participant video grid */}
          <div className={`auraweave-grid ${gridClass}`}>
            {(() => {
              if (gridClass === "layout-screen-share" && hasScreenShare) {
                return (
                  <>
                    <div className="screen-share-main">
                      <div className="auraweave-tile local-tile">
                        {isScreenSharing ? (
                          <video
                            ref={(el) => {
                              if (el) {
                                if (el.srcObject !== localStream) {
                                  el.srcObject = localStream;
                                }
                                if (localStream) {
                                  el.play().catch(() => {});
                                }
                              }
                            }}
                            autoPlay
                            playsInline
                            muted
                            className="tile-video screen"
                          />
                        ) : (
                          <video
                            ref={(el) => {
                              if (el) {
                                if (el.srcObject !== localStream) {
                                  el.srcObject = localStream;
                                }
                                if (localStream && (!isVideoMuted || isScreenSharing)) {
                                  el.play().catch(() => {});
                                }
                              }
                            }}
                            autoPlay
                            playsInline
                            muted
                            style={{ display: isVideoMuted && !isScreenSharing ? "none" : "block" }}
                            className={`tile-video ${isScreenSharing ? "screen" : "mirrored"}`}
                          />
                        )}
                        {isVideoMuted && !isScreenSharing && (
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
                          <span className={`tile-network-dot ${networkLevel}`} title={`Network: ${networkLevel}`} />
                          {isAudioMuted ? (
                            <MicOff size={14} className="tile-muted-icon" />
                          ) : (
                            <Mic size={14} className="tile-mic-icon" />
                          )}
                        </div>
                        {isScreenSharing && <div className="tile-screen-badge">Presenting Screen</div>}
                      </div>
                    </div>
                    <div className="screen-share-sidebar">
                      {remotePeers.map((peer) => (
                        <RemotePeerTile key={peer.peerId} peer={peer} />
                      ))}
                    </div>
                  </>
                );
              }
              return (
                <>
                  {/* Local participant */}
                  <div className="auraweave-tile local-tile">
                    <video
                      ref={(el) => {
                        if (el) {
                          if (el.srcObject !== localStream) {
                            el.srcObject = localStream;
                          }
                          if (localStream && (!isVideoMuted || isScreenSharing)) {
                            el.play().catch(() => {});
                          }
                        }
                      }}
                      autoPlay
                      playsInline
                      muted
                      style={{ display: isVideoMuted && !isScreenSharing ? "none" : "block" }}
                      className={`tile-video ${isScreenSharing ? "screen" : "mirrored"}`}
                    />

                    {isVideoMuted && !isScreenSharing && (
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
                      <span className={`tile-network-dot ${networkLevel}`} title={`Network: ${networkLevel}`} />
                      {isAudioMuted ? (
                        <MicOff size={14} className="tile-muted-icon" />
                      ) : (
                        <Mic size={14} className="tile-mic-icon" />
                      )}
                    </div>

                    {isScreenSharing && <div className="tile-screen-badge">Presenting Screen</div>}
                  </div>

                  {/* Remote participants */}
                  {remotePeers.map((peer) => (
                    <RemotePeerTile key={peer.peerId} peer={peer} />
                  ))}
                </>
              );
            })()}

            {/* Empty meeting placeholder when nobody else has joined */}
            {peers.length === 0 && (
              <div className="empty-stage-box">
                <Radio size={36} className="text-violet-400 mb-2" />
                <h3>Waiting for participants</h3>
                <p className="text-slate-400 text-sm">Other participants will appear here when they join.</p>
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

        {/* In-Meeting Real-Time Chat Drawer */}
        {showChat && (
          <aside className="meeting-chat-drawer">
            <div className="chat-drawer-header">
              <div className="flex items-center gap-2">
                <MessageSquare size={16} className="text-violet-400" />
                <h3>Meeting Chat</h3>
              </div>
              <button
                type="button"
                className="icon-close"
                onClick={() => setShowChat(false)}
                title="Close chat panel"
              >
                <X size={16} />
              </button>
            </div>

            <div className="chat-drawer-notice">
              Messages are visible to everyone currently in this meeting.
            </div>

            <div className="chat-messages-scroll">
              {chatMessages.length === 0 ? (
                <div className="chat-empty-state">
                  <MessageSquare size={30} className="text-slate-600 mb-2" />
                  <p>No messages yet</p>
                  <span>Say hello to everyone in the room!</span>
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`chat-bubble-wrap ${msg.isSelf ? "self" : "remote"}`}
                  >
                    {!msg.isSelf && (
                      <div className="chat-sender-meta">
                        <span className="chat-sender-name">{msg.senderName}</span>
                        <span className="chat-sender-time">{msg.time}</span>
                      </div>
                    )}
                    <div className="chat-bubble">
                      <span className="chat-text">{msg.text}</span>
                      {msg.isSelf && <span className="chat-self-time">{msg.time}</span>}
                    </div>
                  </div>
                ))
              )}
              <div ref={chatBottomRef} />
            </div>

            <form className="chat-drawer-input-form" onSubmit={handleSendChat}>
              <input
                type="text"
                placeholder="Send a message to everyone…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                maxLength={500}
                className="chat-text-input"
              />
              <button
                type="submit"
                disabled={!chatInput.trim()}
                className="chat-send-btn"
                title="Send message"
              >
                <Send size={15} />
              </button>
            </form>
          </aside>
        )}
      </div>

      {/* Floating Bottom Controls */}
      <footer className="meeting-footer">
        <div className="meeting-controls-wrap">
          {/* Group 1: Media controls */}
          <div className="controls-group">
            <>
                <button
                  type="button"
                  className={`control-btn ${isAudioMuted ? "danger" : ""}`}
                  onClick={toggleAudio}
                  title={isAudioMuted ? "Unmute microphone" : "Mute microphone"}
                >
                  {isAudioMuted ? <MicOff size={18} /> : <Mic size={18} />}
                  <span>{isAudioMuted ? "Unmute" : "Mute"}</span>
                </button>

                <button
                  type="button"
                  className={`control-btn ${isVideoMuted ? "danger" : ""}`}
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
                  title="Share Screen to all attendees"
                >
                  <Monitor size={18} />
                  <span>{isScreenSharing ? "Stop Sharing" : "Share"}</span>
                </button>
            </>
          </div>

          <div className="controls-divider" />

          {/* Group 2: Collaboration, Captions & AI */}
          <div className="controls-group">
            <LanguageSelector compact />

            <button
              type="button"
              className={`control-btn ${captionsEnabled ? "accent" : ""}`}
              onClick={() => setCaptionsEnabled(!captionsEnabled)}
              title="Capture live transcript"
            >
              <Subtitles size={18} />
              <span>Live Transcript</span>
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
              className={`control-btn ${showChat ? "accent" : ""}`}
              onClick={() => {
                setShowChat(!showChat);
                setUnreadChatCount(0);
              }}
              title="Meeting Chat"
            >
              <MessageSquare size={18} />
              <span>Chat</span>
              {unreadChatCount > 0 && (
                <span className="chat-unread-badge">{unreadChatCount}</span>
              )}
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
          </div>

          <div className="controls-divider" />

          {/* Group 3: Leave Room */}
          <div className="controls-group">
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
              <div className="ai-source-summary">
                Using {transcript.length} live transcript entries and {chatMessages.length} chat messages.
                Turn on <strong>Live Transcript</strong> during the meeting to capture spoken content.
              </div>
              {aiLoading ? (
                <div className="ai-loading-state">
                  <LoaderCircle className="spin" size={28} />
                  <p>Synthesizing humanized meeting minutes with Groq AI…</p>
                </div>
              ) : aiError ? (
                <div className="notice error">{aiError}</div>
              ) : (
                <div className="ai-summary-text">
                  <FormattedAiNotes text={aiSummary} />
                </div>
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
                <>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={downloadMeetingTranscript}
                  >
                    <Copy size={16} />
                    <span>Export Transcript & Chat</span>
                  </button>
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
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Remote participant tile
function RemotePeerTile({
  peer
}: {
  peer: AuraWeavePeer;
}) {
  const initial = (peer.name.trim() || "P")[0].toUpperCase();
  // Always show video if stream exists - mute status doesn't hide video, only audio
  const showVideo = Boolean(peer.stream);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Dedicated background audio pipeline: guarantees remote voice is always heard even when video is off
  useEffect(() => {
    if (audioRef.current && peer.stream) {
      if (audioRef.current.srcObject !== peer.stream) {
        audioRef.current.srcObject = peer.stream;
      }
      audioRef.current.volume = 1;
      audioRef.current.muted = false;
      const playAudio = () => audioRef.current?.play().catch(() => {});
      audioRef.current.oncanplay = playAudio;
      playAudio();
    }
    return () => {
      if (audioRef.current) audioRef.current.oncanplay = null;
    };
  }, [peer.stream]);

  // Video playback
  useEffect(() => {
    if (videoRef.current && peer.stream) {
      if (videoRef.current.srcObject !== peer.stream) {
        videoRef.current.srcObject = peer.stream;
      }
      if (showVideo) {
        videoRef.current.play().catch(() => {});
      }
    }
  }, [peer.stream]);

  return (
    <div className="auraweave-tile remote-tile">
      {/* Background audio pipeline: guarantees 100% audio transmission regardless of video visibility */}
      <audio ref={audioRef} autoPlay playsInline controls={false} />

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ display: showVideo ? "block" : "none" }}
        className={`tile-video ${peer.isScreenSharing ? "screen" : ""}`}
      />

      {!showVideo && (
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
        <span className={`tile-network-dot ${peer.networkLevel}`} title={`Network: ${peer.networkLevel}`} />
        {peer.isAudioMuted ? (
          <MicOff size={14} className="tile-muted-icon" />
        ) : (
          <Mic size={14} className="tile-mic-icon" />
        )}
      </div>

      {peer.isScreenSharing && <div className="tile-screen-badge">Presenting Screen</div>}

    </div>
  );
}

// Executive Humanized AI Markdown Formatter
function FormattedAiNotes({ text }: { text: string }) {
  if (!text) return null;

  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let inTable = false;
  let tableHeader: string[] = [];
  let tableRows: string[][] = [];

  const parseInline = (str: string): React.ReactNode => {
    const parts = str.split(/(\*\*.*?\*\*|\*.*?\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
        return <em key={i}>{part.slice(1, -1)}</em>;
      }
      return part;
    });
  };

  const flushTable = (key: string) => {
    if (inTable && tableHeader.length > 0) {
      elements.push(
        <div key={key} className="overflow-x-auto my-3">
          <table>
            <thead>
              <tr>
                {tableHeader.map((th, i) => (
                  <th key={i}>{parseInline(th)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx}>{parseInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      inTable = false;
      tableHeader = [];
      tableRows = [];
    }
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      if (cells.every((c) => /^[:-]+$/.test(c))) {
        return;
      }
      if (!inTable) {
        inTable = true;
        tableHeader = cells;
      } else {
        tableRows.push(cells);
      }
      return;
    } else if (inTable) {
      flushTable(`table-${index}`);
    }

    if (!trimmed) return;

    if (trimmed.startsWith("### ")) {
      elements.push(<h3 key={index}>{parseInline(trimmed.slice(4))}</h3>);
    } else if (trimmed.startsWith("## ")) {
      elements.push(<h2 key={index}>{parseInline(trimmed.slice(3))}</h2>);
    } else if (trimmed.startsWith("# ")) {
      elements.push(<h1 key={index}>{parseInline(trimmed.slice(2))}</h1>);
    } else if (trimmed === "---" || trimmed === "***") {
      elements.push(<hr key={index} />);
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      elements.push(
        <ul key={index}>
          <li>{parseInline(trimmed.slice(2))}</li>
        </ul>
      );
    } else {
      elements.push(<p key={index}>{parseInline(trimmed)}</p>);
    }
  });

  if (inTable) {
    flushTable("table-end");
  }

  return <div className="ai-notes-content">{elements}</div>;
}
