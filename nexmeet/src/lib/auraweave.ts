import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrack,
  type RemoteTrackPublication
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

function participantStream(participant: Participant): MediaStream {
  const tracks: MediaStreamTrack[] = [];
  participant.trackPublications.forEach((publication) => {
    if (publication.track?.mediaStreamTrack) {
      tracks.push(publication.track.mediaStreamTrack);
    }
  });
  return new MediaStream(tracks);
}

function peerFromParticipant(participant: Participant): AuraWeavePeer {
  const stream = participantStream(participant);
  return {
    peerId: participantPeerId(participant),
    userId: participant.identity,
    name: participant.name || participant.identity,
    avatarUrl: "",
    role: "presenter",
    stream,
    isAudioMuted: !participant.isMicrophoneEnabled,
    isVideoMuted: !participant.isCameraEnabled,
    isScreenSharing: participant.isScreenShareEnabled
  };
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
  const [error, setError] = useState<string | null>(null);
  const [handsRaised, setHandsRaised] = useState<HandRaisedUser[]>([]);
  const [myHandRaised, setMyHandRaised] = useState(false);
  const [reactions, setReactions] = useState<{ id: string; emoji: string; name: string }[]>([]);
  const onCaptionReceivedRef = useRef<((speaker: string, text: string) => void) | null>(null);

  const syncLocal = useCallback(() => {
    setLocalStream(participantStream(room.localParticipant));
    setIsAudioMuted(!room.localParticipant.isMicrophoneEnabled);
    setIsVideoMuted(!room.localParticipant.isCameraEnabled);
    setIsScreenSharing(room.localParticipant.isScreenShareEnabled);
  }, [room]);

  const syncPeers = useCallback(() => {
    const next = new Map<string, AuraWeavePeer>();
    room.remoteParticipants.forEach((participant) => {
      next.set(participant.identity, peerFromParticipant(participant));
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
    const onData = (payload: Uint8Array, participant?: Participant) => {
      try {
        const message = JSON.parse(new TextDecoder().decode(payload));
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
          .on(RoomEvent.DataReceived, onData);

        await room.connect(data.url, data.token);
        if (!active) {
          await room.disconnect();
          return;
        }
        await room.localParticipant.setMicrophoneEnabled(true);
        syncLocal();
        syncPeers();
        setConnected(true);

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
    await room.localParticipant.setScreenShareEnabled(!room.localParticipant.isScreenShareEnabled);
    syncLocal();
  }, [room, syncLocal]);

  const sendChatMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const message = {
        type: "chat",
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        text: trimmed,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      };
      setChatMessages((previous) => [
        ...previous,
        {
          ...message,
          peerId: user?.id || "",
          senderName: user?.name || "You",
          senderAvatar: user?.avatarUrl || "",
          isSelf: true
        }
      ]);
      await room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify(message)),
        { reliable: true }
      );
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
    error,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    toggleRaiseHand,
    sendReaction,
    promoteToStage: () => {},
    demoteToAudience: () => {},
    broadcastCaption,
    setOnCaptionReceived: (fn: (speaker: string, text: string) => void) => {
      onCaptionReceivedRef.current = fn;
    }
  };
}
