import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  VideoQuality,
  RemoteTrackPublication,
  ConnectionQuality,
  type Participant,
  type RemoteTrack
} from "livekit-client";
import { getApiBase } from "./auth";

export type AuraRole = "host" | "presenter" | "audience";

export interface AuraWeavePeer {
  peerId: string;
  userId: string;
  name: string;
  avatarUrl: string;
  role: AuraRole;
  stream?: MediaStream;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  isScreenSharing: boolean;
  isSpeaking: boolean;
  audioTrackSid?: string;
  networkLevel: 'good' | 'fair' | 'poor';
}


export interface HandRaisedUser {
  peerId: string;
  userId: string;
  name: string;
  avatarUrl: string;
}

export interface ChatMessage {
  id: string;
  peerId: string;
  senderName: string;
  senderAvatar: string;
  text: string;
  time: string;
  isSelf: boolean;
}

function getApiUrl(path: string): string {
  const base = getApiBase();
  return base ? `${base}${path}` : path;
}

function participantPeerId(participant: Participant): string {
  return participant.identity;
}

function participantStream(participant: Participant, stream = new MediaStream()): MediaStream {
  const tracks: MediaStreamTrack[] = [];
  participant.trackPublications.forEach((publication) => {
    if (publication.track?.mediaStreamTrack) {
      tracks.push(publication.track.mediaStreamTrack);
    }
  });
  const desiredTracks = new Set(tracks);
  stream.getTracks().forEach((track) => {
    if (!desiredTracks.has(track)) stream.removeTrack(track);
  });
  tracks.forEach((track) => {
    if (!stream.getTracks().includes(track)) stream.addTrack(track);
  });
  return stream;
}

function mapConnectionQuality(quality: ConnectionQuality | undefined): 'good' | 'fair' | 'poor' {
  if (quality === ConnectionQuality.Poor) return 'fair';
  if (quality === ConnectionQuality.Lost) return 'poor';
  // Default to 'good' (green) for Excellent, Good, or initial Unknown when connected
  return 'good';
}

function peerFromParticipant(participant: Participant, stream?: MediaStream): AuraWeavePeer {
  const participantMediaStream = participantStream(participant, stream);
  const microphonePublication = participant.getTrackPublication(Track.Source.Microphone);
  const cameraPublication = participant.getTrackPublication(Track.Source.Camera);
  return {
    peerId: participantPeerId(participant),
    userId: participant.identity,
    name: participant.name || participant.identity,
    avatarUrl: "",
    role: "presenter",
    stream: participantMediaStream,
    isAudioMuted: microphonePublication
      ? microphonePublication.isMuted
      : !participant.isMicrophoneEnabled,
    isVideoMuted: cameraPublication
      ? cameraPublication.isMuted
      : !participant.isCameraEnabled,
    isScreenSharing: participant.isScreenShareEnabled,
    isSpeaking: participant.isSpeaking,
    audioTrackSid: microphonePublication?.trackSid,
    networkLevel: mapConnectionQuality(participant.connectionQuality)
  };
}

function prioritizeScreenShare(participant: Participant) {
  const publication = participant.getTrackPublication(Track.Source.ScreenShare);
  if (!(publication instanceof RemoteTrackPublication)) return;
  publication.setVideoQuality(VideoQuality.HIGH);
  publication.setVideoDimensions({ width: 1920, height: 1080 });
}

export function useAuraWeave({
  roomName,
  user,
  isHost
}: {
  roomName: string;
  user: { id: string; name: string; avatarUrl?: string } | null;
  isHost: boolean;
}) {
  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true }));
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<Map<string, AuraWeavePeer>>(new Map());
  const [isAudioMuted, setIsAudioMuted] = useState(true);
  const [isVideoMuted, setIsVideoMuted] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [totalParticipants, setTotalParticipants] = useState(1);
  const [connected, setConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  >('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [handsRaised, setHandsRaised] = useState<HandRaisedUser[]>([]);
  const [myHandRaised, setMyHandRaised] = useState(false);
  const [reactions, setReactions] = useState<{ id: string; emoji: string; name: string }[]>([]);
  const [networkLevel, setNetworkLevel] = useState<'good' | 'fair' | 'poor'>('good');
  const onCaptionReceivedRef = useRef<((speaker: string, text: string) => void) | null>(null);
  const localStreamRef = useRef<MediaStream>(new MediaStream());
  const peerStreamsRef = useRef<Map<string, MediaStream>>(new Map());

  const syncLocal = useCallback(() => {
    const stream = participantStream(room.localParticipant, localStreamRef.current);
    setLocalStream(stream);
    setIsAudioMuted(!room.localParticipant.isMicrophoneEnabled);
    setIsVideoMuted(!room.localParticipant.isCameraEnabled);
    setIsScreenSharing(room.localParticipant.isScreenShareEnabled);
  }, [room]);

  const syncPeers = useCallback(() => {
    const next = new Map<string, AuraWeavePeer>();
    room.remoteParticipants.forEach((participant) => {
      prioritizeScreenShare(participant);
      const stream = peerStreamsRef.current.get(participant.identity) || new MediaStream();
      peerStreamsRef.current.set(participant.identity, stream);
      next.set(participant.identity, peerFromParticipant(participant, stream));
    });
    peerStreamsRef.current.forEach((_stream, peerId) => {
      if (!room.remoteParticipants.get(peerId)) peerStreamsRef.current.delete(peerId);
    });
    setPeers(next);
    setTotalParticipants(room.numParticipants || 1);
  }, [room]);

  const refreshParticipant = useCallback(
    (participant: Participant) => {
      if (participant === room.localParticipant) {
        syncLocal();
      } else {
        syncPeers();
      }
    },
    [room, syncLocal, syncPeers]
  );

  useEffect(() => {
    if (!roomName || !user?.id) return;
    let active = true;

    const onTrackChanged = (_track?: RemoteTrack, _publication?: RemoteTrackPublication, participant?: Participant) => {
      if (participant) refreshParticipant(participant);
    };
    const onParticipantChanged = (_publication: unknown, participant: Participant) =>
      refreshParticipant(participant);
    // ---- Chat data handling with chunk reassembly ----
  const incomingChunksRef = useRef(new Map<string, {chunks: string[]; total: number}>());
  const onData = (payload: Uint8Array, participant?: Participant) => {
    try {
      const message = JSON.parse(new TextDecoder().decode(payload));
      // Chunked chat messages
      if (message.type === "chat" && typeof message.chunkData !== "undefined") {
        const id = message.id;
        let entry = incomingChunksRef.current.get(id);
        if (!entry) {
          entry = { chunks: new Array(message.totalChunks), total: message.totalChunks };
          incomingChunksRef.current.set(id, entry);
        }
        entry.chunks[message.chunkIndex] = message.chunkData;
        // If all chunks received, reassemble
        if (entry.chunks.filter(Boolean).length === entry.total) {
          const fullStr = entry.chunks.join("");
          try {
            const fullMsg = JSON.parse(fullStr);
            setChatMessages((prev) => [
              ...prev,
              {
                id: fullMsg.id,
                peerId: participant?.identity || "",
                senderName: participant?.name || "Participant",
                senderAvatar: "",
                text: fullMsg.text,
                time: fullMsg.time,
                isSelf: false
              }
            ]);
          } catch {}
          incomingChunksRef.current.delete(id);
        }
        return; // done handling chunked message
      }
      // Non‑chunked or other message types
      if (message.type === "chat") {
        setChatMessages((previous) => [
          ...previous,
          {
            id: message.id,
            peerId: participant?.identity || "",
            senderName: participant?.name || "Participant",
            senderAvatar: "",
            text: message.text,
            time: message.time,
            isSelf: false
          }
        ]);
      } else if (message.type === "caption") {
        onCaptionReceivedRef.current?.(message.speaker, message.text);
      } else if (message.type === "hand") {
        const handUser: HandRaisedUser = {
          peerId: participant?.identity || "",
          userId: participant?.identity || "",
          name: participant?.name || "Participant",
          avatarUrl: ""
        };
        setHandsRaised((previous) =>
          message.raised
            ? [...previous.filter((item) => item.peerId !== handUser.peerId), handUser]
            : previous.filter((item) => item.peerId !== handUser.peerId)
        );
      } else if (message.type === "reaction" && typeof message.emoji === "string") {
        const reaction = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          emoji: message.emoji,
          name: participant?.name || "Participant"
        };
        setReactions((previous) => [...previous.slice(-4), reaction]);
        window.setTimeout(() => {
          setReactions((previous) => previous.filter((item) => item.id !== reaction.id));
        }, 3000);
      }
    } catch {
      setError("Received invalid meeting data from LiveKit.");
    }
  };

    async function connect() {
      try {
        const response = await fetch(getApiUrl("/api/livekit/token"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("auraclave_auth_token") || ""}`
          },
          body: JSON.stringify({ roomName })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to connect to LiveKit.");

        room
          .on(RoomEvent.TrackSubscribed, onTrackChanged)
          .on(RoomEvent.TrackUnsubscribed, onTrackChanged)
          .on(RoomEvent.LocalTrackPublished, () => syncLocal())
          .on(RoomEvent.LocalTrackUnpublished, () => syncLocal())
          .on(RoomEvent.TrackMuted, onParticipantChanged)
          .on(RoomEvent.TrackUnmuted, onParticipantChanged)
          .on(RoomEvent.ParticipantConnected, (participant) => refreshParticipant(participant))
          .on(RoomEvent.ParticipantDisconnected, () => syncPeers())
          .on(RoomEvent.ActiveSpeakersChanged, () => syncPeers())
          .on(RoomEvent.Reconnecting, () => setConnectionStatus('reconnecting'))
          .on(RoomEvent.Reconnected, () => {
            setConnectionStatus('connected');
            syncLocal();
            syncPeers();
          })
          .on(RoomEvent.Disconnected, () => {
            setConnected(false);
            setConnectionStatus('disconnected');
          })
          .on(RoomEvent.ConnectionQualityChanged, (quality: ConnectionQuality, participant: Participant) => {
            if (participant === room.localParticipant) {
              setNetworkLevel(mapConnectionQuality(quality));
            }
            // Also refresh remote peers so their tiles update
            syncPeers();
          })
          .on(RoomEvent.DataReceived, onData);

        setConnectionStatus('connecting');
        await room.connect(data.url, data.token);
        if (!active) {
          await room.disconnect();
          return;
        }
        await room.localParticipant.setMicrophoneEnabled(true);
        syncLocal();
        syncPeers();
        setConnected(true);
        setConnectionStatus('connected');

        const refreshToken = async () => {
          try {
            const refreshResponse = await fetch(getApiUrl("/api/livekit/token"), {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${localStorage.getItem("auraclave_auth_token") || ""}`
              },
              body: JSON.stringify({ roomName })
            });
            const refreshed = await refreshResponse.json();
            if (!refreshResponse.ok) {
              throw new Error(refreshed.error || "Unable to refresh the meeting token.");
            }

            const microphoneEnabled = room.localParticipant.isMicrophoneEnabled;
            const cameraEnabled = room.localParticipant.isCameraEnabled;
            const screenShareEnabled = room.localParticipant.isScreenShareEnabled;

            // Reconnect before the two-hour token expires. Keeping tracks alive
            // avoids ending the meeting when LiveKit rotates the credentials.
            await room.disconnect(false);
            await room.connect(refreshed.url, refreshed.token);
            await room.localParticipant.setMicrophoneEnabled(microphoneEnabled);
            await room.localParticipant.setCameraEnabled(cameraEnabled);
            if (screenShareEnabled) {
              await room.localParticipant.setScreenShareEnabled(true);
            }
            syncLocal();
            syncPeers();
          } catch (refreshError) {
            setConnectionStatus('reconnecting');
            setError(
              refreshError instanceof Error
                ? `Meeting token refresh failed: ${refreshError.message}`
                : "Meeting token refresh failed."
            );
          }
        };

        const refreshTimer = window.setInterval(refreshToken, 90 * 60 * 1000);
        return () => window.clearInterval(refreshTimer);
      } catch (err) {
        if (active) {
          setConnectionStatus('disconnected');
          setError(err instanceof Error ? err.message : "Unable to connect to the meeting SFU.");
        }
      }
    }

    let cleanupRefresh: (() => void) | undefined;
    connect().then((cleanup) => {
      cleanupRefresh = cleanup;
    });
    return () => {
      active = false;
      cleanupRefresh?.();
      room.removeAllListeners();
      room.disconnect();
      setConnected(false);
      setConnectionStatus('disconnected');
    };
  }, [room, roomName, user?.id, isHost, refreshParticipant, syncLocal, syncPeers]);

  const toggleAudio = useCallback(async () => {
    await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
    syncLocal();
  }, [room, syncLocal]);

  const toggleVideo = useCallback(async () => {
    await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled);
    syncLocal();
  }, [room, syncLocal]);

  const toggleScreenShare = useCallback(async () => {
    try {
      const willEnable = !room.localParticipant.isScreenShareEnabled;
      // setScreenShareEnabled(enabled, captureOptions)
      // Passing { audio: true } prompts for and captures tab/system audio alongside the screen share
      await room.localParticipant.setScreenShareEnabled(willEnable, { audio: true });
      if (willEnable) {
        const publication = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
        const mediaTrack = publication?.track?.mediaStreamTrack;
        if (mediaTrack) mediaTrack.contentHint = "detail";
      }
    } catch (err) {
      console.error("Screen share error:", err);
    } finally {
      syncLocal();
    }
  }, [room, syncLocal]);

  // ------------------- Chat message chunking -------------------
  const MAX_DATA_BYTES = 15000; // LiveKit reliable data safe limit
  const chunkString = (str: string): string[] => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += MAX_DATA_BYTES) {
      const slice = bytes.slice(i, i + MAX_DATA_BYTES);
      chunks.push(new TextDecoder().decode(slice));
    }
    return chunks;
  };

  const sendChatMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const baseMessage = {
        type: "chat",
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        text: trimmed,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      };
      // Optimistically add to UI
      setChatMessages((prev) => [
        ...prev,
        { ...baseMessage, peerId: user?.id || "", senderName: user?.name || "You", senderAvatar: user?.avatarUrl || "", isSelf: true }
      ]);
      // Chunk payload and send sequentially
      const payload = JSON.stringify(baseMessage);
      const chunks = chunkString(payload);
      for (let i = 0; i < chunks.length; i++) {
        const chunkMsg = {
          ...baseMessage,
          chunkIndex: i,
          totalChunks: chunks.length,
          chunkData: chunks[i]
        };
        await room.localParticipant.publishData(
          new TextEncoder().encode(JSON.stringify(chunkMsg)),
          { reliable: true }
        );
        await new Promise((r) => setTimeout(r, 10)); // small pause
      }
    },
    [room, user]
  );

  const broadcastCaption = useCallback(
    async (speaker: string, text: string) => {
      await room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ type: "caption", speaker, text })),
        { reliable: true }
      );
    },
    [room]
  );

  const toggleRaiseHand = useCallback(async () => {
    const raised = !myHandRaised;
    setMyHandRaised(raised);
    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ type: "hand", raised })),
      { reliable: true }
    );
    setHandsRaised((previous) =>
      raised
        ? [...previous.filter((item) => item.peerId !== user?.id), {
            peerId: user?.id || "",
            userId: user?.id || "",
            name: user?.name || "You",
            avatarUrl: user?.avatarUrl || ""
          }]
        : previous.filter((item) => item.peerId !== user?.id)
    );
  }, [myHandRaised, room, user]);

  const sendReaction = useCallback(async (emoji: string) => {
    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ type: "reaction", emoji })),
      { reliable: true }
    );
    const reaction = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      emoji,
      name: user?.name || "You"
    };
    setReactions((previous) => [...previous.slice(-4), reaction]);
    window.setTimeout(() => {
      setReactions((previous) => previous.filter((item) => item.id !== reaction.id));
    }, 3000);
  }, [room, user]);

  return {
    myPeerId: user?.id || "",
    role: isHost ? "host" as AuraRole : "presenter" as AuraRole,
    isStageMember: true,
    localStream,
    peers: Array.from(peers.values()),
    audienceCount: 0,
    totalParticipants,
    handsRaised,
    myHandRaised,
    reactions,
    isAudioMuted,
    isVideoMuted,
    isScreenSharing,
    chatMessages,
    sendChatMessage,
    connected,
    connectionStatus,
    error,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    toggleRaiseHand,
    sendReaction,
    promoteToStage: () => {},
    demoteToAudience: () => {},
    broadcastCaption,
    networkLevel,
    setOnCaptionReceived: (fn: (speaker: string, text: string) => void) => {
      onCaptionReceivedRef.current = fn;
    }
  };
}
