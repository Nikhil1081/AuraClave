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
  Monitor
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage, SUPPORTED_LANGUAGES } from "../contexts/LanguageContext";
import LanguageSelector from "./LanguageSelector";

interface CaptionItem {
  speaker: string;
  text: string;
  time: string;
}

export default function MeetingExtensions({ roomName }: { roomName: string }) {
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

  // 3. Meeting Recording (Audio Only or Screen Video)
  // Mode A: Audio Recording (No screen sharing required!)
  const startAudioRecording = async () => {
    try {
      setShowRecordMenu(false);
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtxClass();
      audioContextRef.current = audioCtx;
      const destination = audioCtx.createMediaStreamDestination();

      // 1. Capture local microphone
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        userMicStreamRef.current = micStream;
        const micSource = audioCtx.createMediaStreamSource(micStream);
        micSource.connect(destination);
      } catch (micErr) {
        console.warn("Could not access local mic, proceeding with room audio:", micErr);
      }

      // 2. Connect remote participants' audio from LiveKit
      if (room) {
        room.remoteParticipants.forEach((participant) => {
          participant.trackPublications.forEach((pub) => {
            if (pub.track && pub.kind === "audio" && (pub.track as any).mediaStreamTrack) {
              try {
                const remoteStream = new MediaStream([(pub.track as any).mediaStreamTrack]);
                const remoteSource = audioCtx.createMediaStreamSource(remoteStream);
                remoteSource.connect(destination);
              } catch (trackErr) {
                console.warn("Could not attach participant audio track:", trackErr);
              }
            }
          });
        });
      }

      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      }

      const mediaRecorder = mimeType
        ? new MediaRecorder(destination.stream, { mimeType })
        : new MediaRecorder(destination.stream);

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

        const blob = new Blob(recordedChunksRef.current, { type: mimeType || "audio/webm" });
        if (blob.size === 0) return;

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        a.download = `AuraClave-Audio-${roomName}-${timestamp}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      };

      mediaRecorder.start(1000);
      mediaRecorderRef.current = mediaRecorder;
      setRecordingMode("audio");
      setIsRecording(true);

      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((sec) => sec + 1);
      }, 1000);
    } catch (err: any) {
      console.error("Audio recording error:", err);
      alert("Could not start audio recording: " + (err?.message || "Error"));
    }
  };

  // Mode B: Screen & Video Recording
  const startScreenRecording = async () => {
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

        // Stop all tracks in display stream
        stream.getTracks().forEach((track) => track.stop());

        const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
        if (blob.size === 0) return;

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        a.download = `AuraClave-Video-${roomName}-${timestamp}.webm`;
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
      console.error("Recording error:", err);
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
                onClick={startAudioRecording}
                type="button"
              >
                <div className="record-menu-icon audio">
                  <Mic size={17} />
                </div>
                <div className="record-menu-info">
                  <span className="record-menu-title">Record Meeting Audio</span>
                  <span className="record-menu-sub">No screen sharing needed. Captures all participant voices.</span>
                </div>
              </button>

              <button
                className="record-menu-item"
                onClick={startScreenRecording}
                type="button"
              >
                <div className="record-menu-icon video">
                  <Monitor size={17} />
                </div>
                <div className="record-menu-info">
                  <span className="record-menu-title">Record Screen & Video</span>
                  <span className="record-menu-sub">Captures your screen, presentations, and meeting video.</span>
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
