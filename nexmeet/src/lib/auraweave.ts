import { useEffect, useRef, useState, useCallback } from "react";
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

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" }
];

function getAuraWeaveWsUrl(): string {
  const base = getApiBase();
  if (base) {
    const wsProto = base.startsWith("https") ? "wss" : "ws";
    return `${wsProto}://${base.replace(/^https?:\/\//, "")}/auraweave`;
  }
  const isHttps = window.location.protocol === "https:";
  const host = window.location.hostname === "localhost" ? "localhost:5000" : window.location.host;
  return `${isHttps ? "wss" : "ws"}://${host}/auraweave`;
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
  const [role, setRole] = useState<AuraRole>(isHost ? "host" : "audience");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<Map<string, AuraWeavePeer>>(new Map());
  const [audienceCount, setAudienceCount] = useState<number>(0);
  const [totalParticipants, setTotalParticipants] = useState<number>(1);
  const [handsRaised, setHandsRaised] = useState<HandRaisedUser[]>([]);
  const [myHandRaised, setMyHandRaised] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const myPeerIdRef = useRef<string>("");
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const queuedCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const onCaptionReceivedRef = useRef<((speaker: string, text: string) => void) | null>(null);

  const isStageMember = role === "host" || role === "presenter";

  // 1. Initialize Local Media only when on Stage (Host / Presenter)
  useEffect(() => {
    let active = true;

    async function initMedia() {
      if (!isStageMember) {
        // Audience members do not publish camera or microphone
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((t) => t.stop());
          localStreamRef.current = null;
          setLocalStream(null);
        }
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }
        });

        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        localStreamRef.current = stream;
        cameraTrackRef.current = stream.getVideoTracks()[0] || null;
        setLocalStream(stream);

        // Attach local tracks to all existing peer connections
        peerConnectionsRef.current.forEach((pc) => {
          stream.getTracks().forEach((track) => {
            const senders = pc.getSenders();
            const exists = senders.some((s) => s.track?.kind === track.kind);
            if (!exists) {
              pc.addTrack(track, stream);
            }
          });
        });
      } catch (err: any) {
        console.warn("Could not acquire video & audio, falling back to audio only:", err);
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (!active) {
            audioStream.getTracks().forEach((t) => t.stop());
            return;
          }
          localStreamRef.current = audioStream;
          setIsVideoMuted(true);
          setLocalStream(audioStream);
        } catch {
          setError("Microphone/camera access denied. You can still participate in the audience.");
        }
      }
    }

    initMedia();

    return () => {
      active = false;
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
    };
  }, [isStageMember]);

  // 2. Connect to AuraWeave Signaling Server
  useEffect(() => {
    if (!roomName || !user?.id) return;

    const wsUrl = getAuraWeaveWsUrl();
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);

      ws.send(
        JSON.stringify({
          type: "join",
          data: {
            roomName,
            userId: user.id,
            name: user.name || "Guest",
            avatarUrl: user.avatarUrl || "",
            isHost
          }
        })
      );
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        const { type, data } = msg;

        switch (type) {
          case "joined": {
            myPeerIdRef.current = data.peerId;
            setRole(data.role);
            setAudienceCount(data.totalAudience || 0);
            setTotalParticipants(data.totalRoomMembers || 1);
            setHandsRaised(data.handsRaised || []);

            // Connect to active stage members
            const stageMembers: any[] = data.stageMembers || [];
            stageMembers.forEach((p) => {
              addPeerState(p);
              // Stage members or audience establish WebRTC connection to download stage video
              createPeerConnection(p.peerId, true);
            });
            break;
          }

          case "stage-member-added": {
            addPeerState(data);
            createPeerConnection(data.peerId, false);
            break;
          }

          case "role-changed": {
            setRole(data.role);
            if (data.role === "audience") {
              setMyHandRaised(false);
            }
            break;
          }

          case "room-summary": {
            setAudienceCount(data.audienceCount || 0);
            setTotalParticipants(data.totalParticipants || 1);
            setHandsRaised(data.handsRaised || []);

            // Synchronize stage members
            const stageMembers: any[] = data.stageMembers || [];
            stageMembers.forEach((sm) => {
              addPeerState(sm);
            });
            break;
          }

          case "signal": {
            const { senderPeerId, signal } = data;
            handleRemoteSignal(senderPeerId, signal);
            break;
          }

          case "peer-media-state": {
            setPeers((prev) => {
              const next = new Map(prev);
              const p = next.get(data.peerId);
              if (p) {
                next.set(data.peerId, {
                  ...p,
                  isAudioMuted: data.isAudioMuted ?? p.isAudioMuted,
                  isVideoMuted: data.isVideoMuted ?? p.isVideoMuted,
                  isScreenSharing: data.isScreenSharing ?? p.isScreenSharing
                });
              }
              return next;
            });
            break;
          }

          case "live-caption": {
            if (onCaptionReceivedRef.current) {
              onCaptionReceivedRef.current(data.speaker, data.text);
            }
            break;
          }

          case "peer-left": {
            removePeer(data.peerId);
            break;
          }
        }
      } catch (err) {
        console.error("AuraWeave message handling error:", err);
      }
    };

    ws.onerror = () => {};
    ws.onclose = () => setConnected(false);

    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 20000);

    return () => {
      clearInterval(pingInterval);
      ws.close();
      peerConnectionsRef.current.forEach((pc) => pc.close());
      peerConnectionsRef.current.clear();
    };
  }, [roomName, user?.id, isHost]);

  const addPeerState = (peer: AuraWeavePeer) => {
    setPeers((prev) => {
      const next = new Map(prev);
      const existing = next.get(peer.peerId);
      next.set(peer.peerId, { ...existing, ...peer });
      return next;
    });
  };

  const removePeer = (peerId: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc) {
      pc.close();
      peerConnectionsRef.current.delete(peerId);
    }
    setPeers((prev) => {
      const next = new Map(prev);
      next.delete(peerId);
      return next;
    });
  };

  // 3. WebRTC PeerConnection Management
  const createPeerConnection = (targetPeerId: string, isInitiator: boolean) => {
    if (peerConnectionsRef.current.has(targetPeerId)) {
      return peerConnectionsRef.current.get(targetPeerId)!;
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peerConnectionsRef.current.set(targetPeerId, pc);

    // Only add local tracks if we are on the Stage (Host / Presenter)
    if (isStageMember && localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "signal",
            data: {
              targetPeerId,
              signal: { candidate: event.candidate }
            }
          })
        );
      }
    };

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      setPeers((prev) => {
        const next = new Map(prev);
        const p = next.get(targetPeerId);
        if (p) {
          next.set(targetPeerId, { ...p, stream: remoteStream });
        }
        return next;
      });
    };

    pc.onnegotiationneeded = async () => {
      if (!isInitiator) return;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "signal",
              data: {
                targetPeerId,
                signal: { sdp: pc.localDescription }
              }
            })
          );
        }
      } catch (err) {
        console.error("Negotiation error:", err);
      }
    };

    return pc;
  };

  const handleRemoteSignal = async (senderPeerId: string, signal: any) => {
    let pc = peerConnectionsRef.current.get(senderPeerId);
    if (!pc) {
      pc = createPeerConnection(senderPeerId, false);
    }

    try {
      if (signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

        const queued = queuedCandidatesRef.current.get(senderPeerId) || [];
        for (const cand of queued) {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        }
        queuedCandidatesRef.current.delete(senderPeerId);

        if (signal.sdp.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: "signal",
                data: {
                  targetPeerId: senderPeerId,
                  signal: { sdp: pc.localDescription }
                }
              })
            );
          }
        }
      } else if (signal.candidate) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } else {
          const currentQueue = queuedCandidatesRef.current.get(senderPeerId) || [];
          currentQueue.push(signal.candidate);
          queuedCandidatesRef.current.set(senderPeerId, currentQueue);
        }
      }
    } catch (err) {
      console.error("Error processing remote signal:", err);
    }
  };

  // 4. Media Controls
  const toggleAudio = useCallback(() => {
    if (!localStreamRef.current) return;
    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      const muted = !audioTrack.enabled;
      setIsAudioMuted(muted);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "media-state",
            data: { isAudioMuted: muted }
          })
        );
      }
    }
  }, []);

  const toggleVideo = useCallback(() => {
    if (!localStreamRef.current) return;
    const videoTrack = localStreamRef.current.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      const muted = !videoTrack.enabled;
      setIsVideoMuted(muted);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "media-state",
            data: { isVideoMuted: muted }
          })
        );
      }
    }
  }, []);

  const toggleScreenShare = useCallback(async () => {
    if (!localStreamRef.current) return;

    if (isScreenSharing) {
      if (screenTrackRef.current) {
        screenTrackRef.current.stop();
        screenTrackRef.current = null;
      }

      if (cameraTrackRef.current) {
        peerConnectionsRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender && cameraTrackRef.current) {
            sender.replaceTrack(cameraTrackRef.current);
          }
        });
      }
      setIsScreenSharing(false);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "media-state",
            data: { isScreenSharing: false }
          })
        );
      }
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });
        const screenTrack = screenStream.getVideoTracks()[0];
        screenTrackRef.current = screenTrack;

        screenTrack.onended = () => {
          toggleScreenShare();
        };

        peerConnectionsRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender) {
            sender.replaceTrack(screenTrack);
          }
        });

        setIsScreenSharing(true);

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "media-state",
              data: { isScreenSharing: true }
            })
          );
        }
      } catch (err) {
        console.warn("Screen share cancelled:", err);
      }
    }
  }, [isScreenSharing]);

  // 5. Stage & Audience Actions for 1,000 Capacity
  const toggleRaiseHand = useCallback(() => {
    const nextState = !myHandRaised;
    setMyHandRaised(nextState);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "raise-hand",
          data: { raised: nextState }
        })
      );
    }
  }, [myHandRaised]);

  const promoteToStage = useCallback((targetPeerId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "promote-to-stage",
          data: { targetPeerId }
        })
      );
    }
  }, []);

  const demoteToAudience = useCallback((targetPeerId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "demote-to-audience",
          data: { targetPeerId }
        })
      );
    }
  }, []);

  const broadcastCaption = useCallback((speaker: string, text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "caption-broadcast",
          data: { speaker, text }
        })
      );
    }
  }, []);

  const setOnCaptionReceived = (fn: (speaker: string, text: string) => void) => {
    onCaptionReceivedRef.current = fn;
  };

  return {
    role,
    isStageMember,
    localStream,
    peers: Array.from(peers.values()).filter((p) => p.role === "host" || p.role === "presenter"),
    audienceCount,
    totalParticipants,
    handsRaised,
    myHandRaised,
    isAudioMuted,
    isVideoMuted,
    isScreenSharing,
    connected,
    error,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    toggleRaiseHand,
    promoteToStage,
    demoteToAudience,
    broadcastCaption,
    setOnCaptionReceived
  };
}
