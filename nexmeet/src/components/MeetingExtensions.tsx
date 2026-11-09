import { useEffect, useRef, useState } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import {
  Subtitles,
  CircleDot,
  Square,
  Sparkles,
  X,
  Copy,
  Check,
  Download,
  LoaderCircle,
  Mic,
  Monitor,
  Share2,
  Video
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage, SUPPORTED_LANGUAGES } from "../contexts/LanguageContext";
import LanguageSelector from "./LanguageSelector";

interface CaptionItem {
  speaker: string;
  text: string;
  time: string;
}

export default function MeetingExtensions({
  roomName,
  onOpenShare
}: {
  roomName: string;
  onOpenShare?: () => void;
}) {
  const room = useRoomContext();
  const { session, user } = useAuth();
  const { language, t, currentSpeechCode } = useLanguage();

  // Captions state
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [currentCaption, setCurrentCaption] = useState<{ speaker: string; text: string } | null>(null);
  const [transcript, setTranscript] = useState<CaptionItem[]>([]);
  const recognitionRef = useRef<any>(null);
  const captionTimeoutRef = useRef<any>(null);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [showRecordMenu, setShowRecordMenu] = useState(false);
  const [recordingMode, setRecordingMode] = useState<"audio" | "video">("audio");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const userMicStreamRef = useRef<MediaStream | null>(null);
  const recordMenuRef = useRef<HTMLDivElement>(null);

  // Close record dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (recordMenuRef.current && !recordMenuRef.current.contains(event.target as Node)) {
        setShowRecordMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // AI Summary Modal state
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [copied, setCopied] = useState(false);

  // 1. LiveKit Data Channel listener for remote captions
  useEffect(() => {
    if (!room) return;

    const handleData = (payload: Uint8Array, participant?: any) => {
      try {
        const text = new TextDecoder().decode(payload);
        const data = JSON.parse(text);
        if (data.type === "caption") {
          const speakerName = data.speaker || participant?.name || "Participant";
          setCurrentCaption({ speaker: speakerName, text: data.text });

          setTranscript((prev) => [
            ...prev,
            {
              speaker: speakerName,
              text: data.text,
              time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            }
          ]);

          if (captionTimeoutRef.current) clearTimeout(captionTimeoutRef.current);
          captionTimeoutRef.current = setTimeout(() => {
            setCurrentCaption(null);
          }, 4500);
        }
      } catch (err) {
        console.error("Error decoding caption packet", err);
      }
    };

    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room]);

  // 2. Web Speech Recognition for local user
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
      alert("Live captions: Speech recognition is not supported in this browser. Please use Google Chrome, Edge, or Safari.");
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

      const spokenText = (final || interim).trim();
      if (!spokenText) return;

      const myName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "You";

      setCurrentCaption({ speaker: myName, text: spokenText });

      if (captionTimeoutRef.current) clearTimeout(captionTimeoutRef.current);
      captionTimeoutRef.current = setTimeout(() => {
        setCurrentCaption(null);
      }, 4500);

      // If final sentence, broadcast to all participants and store in transcript
      if (final.trim()) {
        const payload = JSON.stringify({
          type: "caption",
          speaker: myName,
          text: final.trim()
        });
        const encoded = new TextEncoder().encode(payload);

        try {
          room.localParticipant.publishData(encoded, { reliable: true });
        } catch (e) {
          console.warn("Could not publish caption data", e);
        }

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

    recognition.onerror = (e: any) => {
      if (e.error !== "no-speech") {
        console.warn("Speech recognition error:", e.error);
      }
    };

    recognition.onend = () => {
      // Auto-restart if user still has captions enabled
      if (captionsEnabled) {
        try {
          recognition.start();
        } catch {}
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch (e) {
      console.warn("Failed to start speech recognition", e);
    }

    return () => {
      try {
        recognition.stop();
      } catch {}
    };
  }, [captionsEnabled, room, user, currentSpeechCode]);

  // 3. Reflect Custom Name & DP directly onto LiveKit Participant Tiles inside the call
  useEffect(() => {
    if (!room) return;

    const avatar = user?.user_metadata?.avatar_url || "";
    const name = user?.user_metadata?.full_name || user?.email || "";

    try {
      if ((room.localParticipant as any).setName && name) {
        (room.localParticipant as any).setName(name);
      }
      if ((room.localParticipant as any).setMetadata) {
        (room.localParticipant as any).setMetadata(
          JSON.stringify({ avatar_url: avatar, full_name: name })
        );
      }
    } catch {}

    function updateTiles() {
      const tiles = document.querySelectorAll(".lk-participant-tile");
      tiles.forEach((tile) => {
        const placeholder = tile.querySelector(".lk-participant-placeholder");
        if (!placeholder) return;

        const isLocal = tile.getAttribute("data-lk-local-participant") === "true";
        let curAvatar = "";
        let curName = "";

        if (isLocal) {
          curAvatar = user?.user_metadata?.avatar_url || "";
          curName = user?.user_metadata?.full_name || user?.email || "You";
        } else {
          const identity = tile.getAttribute("data-lk-participant-identity") || "";
          const remote = Array.from(room.remoteParticipants.values()).find((p) => p.identity === identity);
          if (remote?.metadata) {
            try {
              const meta = JSON.parse(remote.metadata);
              curAvatar = meta.avatar_url || "";
              curName = meta.full_name || remote.name || "";
            } catch {}
          }
          if (!curName && remote?.name) curName = remote.name;
        }

        const initial = (curName.trim() || "U")[0].toUpperCase();
        const existingImg = placeholder.querySelector(".lk-custom-dp") as HTMLImageElement | null;
        const existingFallback = placeholder.querySelector(".lk-custom-dp-fallback");

        if (curAvatar) {
          if (!existingImg || existingImg.src !== curAvatar) {
            placeholder.innerHTML = `<img src="${curAvatar}" alt="${curName}" class="lk-custom-dp" />`;
          }
        } else {
          if (!existingFallback || existingFallback.textContent !== initial) {
            placeholder.innerHTML = `<div class="lk-custom-dp-fallback">${initial}</div>`;
          }
        }
      });
    }

    updateTiles();
    const interval = setInterval(updateTiles, 1000);
    return () => clearInterval(interval);
  }, [room, user]);

  // 3. Meeting Recording (Zero-Prompt Meeting Recording + Audio/Screen)
  // Smart Meeting Recording: Automatically grabs incoming screen share or room video + audio with ZERO PROMPTS!
  const startMeetingRecording = async (forceAudioOnly = false) => {
    try {
      setShowRecordMenu(false);
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtxClass();
      audioContextRef.current = audioCtx;
      const destination = audioCtx.createMediaStreamDestination();

      // 1. Capture local mic
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        userMicStreamRef.current = micStream;
        const micSource = audioCtx.createMediaStreamSource(micStream);
        micSource.connect(destination);
      } catch (micErr) {
        console.warn("Could not attach local mic:", micErr);
      }

      // 2. Connect all remote participants' audio from LiveKit
      if (room) {
        room.remoteParticipants.forEach((participant) => {
          participant.trackPublications.forEach((pub) => {
            if (pub.track && pub.kind === "audio" && (pub.track as any).mediaStreamTrack) {
              try {
                const remoteStream = new MediaStream([(pub.track as any).mediaStreamTrack]);
                const remoteSource = audioCtx.createMediaStreamSource(remoteStream);
                remoteSource.connect(destination);
              } catch (trackErr) {
                console.warn("Could not attach participant audio:", trackErr);
              }
            }
          });
        });
      }

      // 3. Find active screen share or video in room (NO PROMPT NEEDED!)
      let activeVideoTrack: MediaStreamTrack | null = null;

      if (!forceAudioOnly && room) {
        // Priority 1: Check remote participants for screen share (e.g. host's screen share)
        for (const p of room.remoteParticipants.values()) {
          for (const pub of p.trackPublications.values()) {
            if (pub.source === "screen_share" && pub.track && (pub.track as any).mediaStreamTrack) {
              activeVideoTrack = (pub.track as any).mediaStreamTrack;
              break;
            }
          }
          if (activeVideoTrack) break;
        }

        // Priority 2: Check local participant's screen share
        if (!activeVideoTrack && room.localParticipant) {
          for (const pub of room.localParticipant.trackPublications.values()) {
            if (pub.source === "screen_share" && pub.track && (pub.track as any).mediaStreamTrack) {
              activeVideoTrack = (pub.track as any).mediaStreamTrack;
              break;
            }
          }
        }

        // Priority 3: Check remote participant camera video
        if (!activeVideoTrack) {
          for (const p of room.remoteParticipants.values()) {
            for (const pub of p.trackPublications.values()) {
              if (pub.kind === "video" && pub.track && (pub.track as any).mediaStreamTrack) {
                activeVideoTrack = (pub.track as any).mediaStreamTrack;
                break;
              }
            }
            if (activeVideoTrack) break;
          }
        }
      }

      let streamToRecord: MediaStream;
      let mimeType = "video/webm";

      if (activeVideoTrack) {
        streamToRecord = new MediaStream([activeVideoTrack, ...destination.stream.getAudioTracks()]);
        mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
          ? "video/webm;codecs=vp9,opus"
          : "video/webm";
        setRecordingMode("video");
      } else {
        streamToRecord = destination.stream;
        mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";
        setRecordingMode("audio");
      }

      const mediaRecorder = new MediaRecorder(streamToRecord, { mimeType });
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        clearInterval(timerIntervalRef.current);
        setRecordingSeconds(0);
        setIsRecording(false);

        if (userMicStreamRef.current) {
          userMicStreamRef.current.getTracks().forEach((track) => track.stop());
          userMicStreamRef.current = null;
        }
        if (audioContextRef.current && audioContextRef.current.state !== "closed") {
          audioContextRef.current.close().catch(() => {});
          audioContextRef.current = null;
        }

        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        if (blob.size === 0) return;

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const isVid = streamToRecord.getVideoTracks().length > 0;
        a.download = `AuraClave-${isVid ? "Meeting" : "Audio"}-${roomName}-${timestamp}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      };

      mediaRecorder.start(1000);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);

      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((sec) => sec + 1);
      }, 1000);
    } catch (err: any) {
      console.error("Recording error:", err);
      alert("Could not start recording: " + (err?.message || "Error"));
    }
  };

  // Mode C: Manual Desktop Screen Picker (only if user explicitly wants whole monitor)
  const startDesktopRecording = async () => {
    try {
      setShowRecordMenu(false);
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });

      let mimeType = "video/webm;codecs=vp9,opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "video/webm";
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        clearInterval(timerIntervalRef.current);
        setRecordingSeconds(0);
        setIsRecording(false);
        stream.getTracks().forEach((track) => track.stop());

        const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
        if (blob.size === 0) return;

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        a.download = `AuraClave-Desktop-${roomName}-${timestamp}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      };

      if (stream.getVideoTracks().length > 0) {
        stream.getVideoTracks()[0].onended = () => {
          if (mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
          }
        };
      }

      mediaRecorder.start(1000);
      mediaRecorderRef.current = mediaRecorder;
      setRecordingMode("video");
      setIsRecording(true);

      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((sec) => sec + 1);
      }, 1000);
    } catch (err: any) {
      console.error("Desktop recording error:", err);
      if (err.name !== "NotAllowedError") {
        alert("Could not start recording: " + (err?.message || "Permission denied"));
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // 4. Generate AI Summary with Groq
  const generateSummary = async () => {
    if (transcript.length === 0) {
      setAiError("No meeting transcript recorded yet. Turn on Live Captions or speak first!");
      return;
    }

    setAiLoading(true);
    setAiError("");

    try {
      const langName = SUPPORTED_LANGUAGES.find((l) => l.code === language)?.label || "English";
      const fullText =
        transcript
          .map((item) => `[${item.time}] ${item.speaker}: ${item.text}`)
          .join("\n") +
        (language !== "en"
          ? `\n\n(IMPORTANT: Please format and write the meeting summary and action items in ${langName})`
          : "");

      const apiUrl = import.meta.env.VITE_API_URL
        ? `${import.meta.env.VITE_API_URL}/api/ai`
        : "/api/ai";

      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token || ""}`
        },
        body: JSON.stringify({
          text: fullText,
          task: "summarize"
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate AI summary.");
      }

      setAiSummary(data.result || "No summary generated.");
    } catch (err: any) {
      setAiError(err.message || "Failed to contact AI service.");
    } finally {
      setAiLoading(false);
    }
  };

  const copySummary = () => {
    navigator.clipboard.writeText(aiSummary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadTranscript = () => {
    const content = transcript
      .map((item) => `[${item.time}] ${item.speaker}: ${item.text}`)
      .join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `AuraClave-Transcript-${roomName}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* Top Floating Action Bar */}
      <div className="meeting-custom-bar">
        <LanguageSelector compact />

        {/* Recording Menu & Button */}
        <div className="record-container" ref={recordMenuRef}>
          {isRecording ? (
            <button
              className="action-pill recording-active"
              onClick={stopRecording}
              title="Stop and save recording"
            >
              <Square size={13} fill="#ff4d6d" color="#ff4d6d" />
              <span className="rec-text">
                REC {recordingMode === "audio" ? "AUDIO" : "VIDEO"} {formatTimer(recordingSeconds)}
              </span>
            </button>
          ) : (
            <button
              className="action-pill"
              onClick={() => setShowRecordMenu(!showRecordMenu)}
              title="Record meeting"
            >
              <CircleDot size={15} color="#fa5252" />
              <span>{t("meeting_record")}</span>
            </button>
          )}

          {showRecordMenu && !isRecording && (
            <div className="record-menu-popover">
              <div className="record-menu-header">Select Recording Mode</div>
              <button
                className="record-menu-item"
                onClick={() => startMeetingRecording(false)}
                type="button"
              >
                <div className="record-menu-icon video">
                  <Video size={17} />
                </div>
                <div className="record-menu-info">
                  <span className="record-menu-title">Record Meeting (Zero Prompts)</span>
                  <span className="record-menu-sub">Captures active screen share or video & all voices without asking to share.</span>
                </div>
              </button>

              <button
                className="record-menu-item"
                onClick={() => startMeetingRecording(true)}
                type="button"
              >
                <div className="record-menu-icon audio">
                  <Mic size={17} />
                </div>
                <div className="record-menu-info">
                  <span className="record-menu-title">Record Meeting Audio Only</span>
                  <span className="record-menu-sub">Pure audio recording of all participants and voices.</span>
                </div>
              </button>

              <button
                className="record-menu-item"
                onClick={startDesktopRecording}
                type="button"
              >
                <div className="record-menu-icon desktop">
                  <Monitor size={17} />
                </div>
                <div className="record-menu-info">
                  <span className="record-menu-title">Record My Desktop Screen</span>
                  <span className="record-menu-sub">Select your own desktop monitor or specific window.</span>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Live Captions Toggle */}
        <button
          className={`action-pill ${captionsEnabled ? "captions-active" : ""}`}
          onClick={() => setCaptionsEnabled(!captionsEnabled)}
          title={captionsEnabled ? "Turn off live captions" : "Turn on live captions"}
        >
          <Subtitles size={15} />
          <span>{captionsEnabled ? t("meeting_captions_on") : t("meeting_captions")}</span>
        </button>

        {/* AI Meeting Summary */}
        <button
          className="action-pill ai-pill"
          onClick={() => setShowAiModal(true)}
          title="Open AI Meeting Notes & Summary"
        >
          <Sparkles size={15} />
          <span>{t("meeting_ai_notes")}</span>
        </button>

        {/* Share Meeting Link Button */}
        {onOpenShare && (
          <button
            className="action-pill share-pill"
            onClick={onOpenShare}
            title="Share meeting invite link"
          >
            <Share2 size={15} />
            <span>Share</span>
          </button>
        )}
      </div>

      {/* Subtitles Overlay Banner (Bottom Center) */}
      {currentCaption && (
        <div className="subtitles-banner">
          <span className="caption-speaker">{currentCaption.speaker}:</span>
          <span className="caption-text">{currentCaption.text}</span>
        </div>
      )}

      {/* AI Summary / Transcript Modal */}
      {showAiModal && (
        <div className="modal-backdrop" onClick={() => setShowAiModal(false)}>
          <div className="ai-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <Sparkles size={18} color="#8aa5ff" />
                <span>AuraClave AI Meeting Assistant</span>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowAiModal(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              {/* Transcript Preview */}
              <div className="transcript-section">
                <div className="section-head">
                  <b>Live Transcript ({transcript.length} lines)</b>
                  {transcript.length > 0 && (
                    <button
                      className="text-btn"
                      onClick={downloadTranscript}
                      title="Download transcript as text"
                    >
                      <Download size={13} /> Export
                    </button>
                  )}
                </div>
                <div className="transcript-box">
                  {transcript.length === 0 ? (
                    <div className="empty-state">
                      No speech recorded yet. Make sure <b>CC</b> (Captions) is enabled and speak into your mic!
                    </div>
                  ) : (
                    transcript.map((item, idx) => (
                      <div key={idx} className="transcript-line">
                        <span className="t-time">{item.time}</span>
                        <b className="t-speaker">{item.speaker}:</b>
                        <span className="t-text">{item.text}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Generate Button */}
              <button
                className="button primary full generate-btn"
                onClick={generateSummary}
                disabled={aiLoading || transcript.length === 0}
              >
                {aiLoading ? (
                  <>
                    <LoaderCircle size={16} className="spin" /> Generating AI Summary with Groq…
                  </>
                ) : (
                  <>
                    <Sparkles size={16} /> Generate Meeting Summary & Action Items
                  </>
                )}
              </button>

              {aiError && <div className="notice error-notice">{aiError}</div>}

              {/* AI Result Box */}
              {aiSummary && (
                <div className="summary-result-box">
                  <div className="result-head">
                    <b>AI Meeting Summary</b>
                    <button className="text-btn" onClick={copySummary}>
                      {copied ? <Check size={14} color="#56d6a0" /> : <Copy size={14} />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="summary-markdown">{aiSummary}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
