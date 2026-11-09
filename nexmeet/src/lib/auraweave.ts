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

export interface ChatMessage {
  id: string;
  peerId: string;
  senderName: string;
  senderAvatar: string;
  text: string;
  time: string;
  isSelf: boolean;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
  { urls: "stun:stun.relay.metered.ca:80" },
  {
    urls: "turn:global.relay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject"
  },
  {
    urls: "turn:global.relay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject"
  },
  {
    urls: "turn:global.relay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject"
  }
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
  // Everyone has full speaking, video, and screen sharing permissions by default
  const [role, setRole] = useState<AuraRole>(isHost ? "host" : "presenter");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [peers, setPeers] = useState<Map<string, AuraWeavePeer>>(new Map());
  const [audienceCount, setAudienceCount] = useState<number>(0);
  const [totalParticipants, setTotalParticipants] = useState<number>(1);
  const [handsRaised, setHandsRaised] = useState<HandRaisedUser[]>([]);
  const [myHandRaised, setMyHandRaised] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const myPeerIdRef = useRef<string>("");
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const queuedCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const makingOfferRef = useRef<Set<string>>(new Set());
  const onCaptionReceivedRef = useRef<((speaker: string, text: string) => void) | null>(null);

  // Every participant can publish audio, video, and screen share. The role is
  // retained for display and host-only moderation controls.
  const isStageMember = true;

  // 1. Initialize Local Media (Camera & Microphone) for All Participants
  useEffect(() => {
    let active = true;

    async function initMedia() {
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

          peerConnectionsRef.current.forEach((pc) => {
            audioStream.getTracks().forEach((track) => {
              const senders = pc.getSenders();
              const exists = senders.some((s) => s.track?.kind === track.kind);
              if (!exists) {
                pc.addTrack(track, audioStream);
              }
            });
          });
        } catch {
          console.warn("Microphone access denied or not available");
          setIsVideoMuted(true);
          setIsAudioMuted(true);
        }
      } finally {
        if (active) {
          setMediaReady(true);
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
  }, []);

  // 2. Connect to AuraWeave Signaling Server once Media is ready
  useEffect(() => {
    if (!roomName || !user?.id || !mediaReady) return;

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

            // Connect to every participant already in the room.
            const stageMembers: any[] = data.stageMembers || [];
            stageMembers.forEach((p) => {
              addPeerState(p);
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

            // Synchronize all participants currently in the room.
            const serverStageList: any[] = data.stageMembers || [];
            const activeRemotePeerIds = new Set(
              serverStageList
                .filter(
                  (sm) =>
                    sm.peerId !== myPeerIdRef.current &&
                    (!user?.id || sm.userId !== user.id) &&
                    (!user?.name || sm.name !== user.name)
                )
                .map((sm) => sm.peerId)
            );

            setPeers((prev) => {
              const next = new Map();
              prev.forEach((peer, pId) => {
                if (activeRemotePeerIds.has(pId)) {
                  next.set(pId, peer);
                } else {
                  const pc = peerConnectionsRef.current.get(pId);
                  if (pc) {
                    pc.close();
                    peerConnectionsRef.current.delete(pId);
                  }
                }
              });
              return next;
            });

            serverStageList.forEach((sm) => {
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

          case "chat-message": {
            setChatMessages((prev) => [
              ...prev,
              {
                id: data.id || `${Date.now()}_${Math.random()}`,
                peerId: data.peerId,
                senderName: data.senderName,
                senderAvatar: data.senderAvatar,
                text: data.text,
                time: data.time || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                isSelf: false
              }
            ]);
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
  }, [roomName, user?.id, isHost, mediaReady]);

  const addPeerState = (peer: AuraWeavePeer) => {
    // Never add ourselves as a remote peer
    if (
      peer.peerId === myPeerIdRef.current ||
      (user?.id && peer.userId === user.id) ||
      (user?.name && peer.name === user.name && peer.name !== "Guest")
    ) {
      return;
    }
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
  const createPeerConnection = (targetPeerId: string, isInitiator: boolean): RTCPeerConnection | null => {
    if (!targetPeerId || targetPeerId === myPeerIdRef.current) return null;
    if (peerConnectionsRef.current.has(targetPeerId)) {
      return peerConnectionsRef.current.get(targetPeerId)!;
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peerConnectionsRef.current.set(targetPeerId, pc);

    // Add local tracks (microphone and camera) to peer connection
    if (localStreamRef.current) {
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

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed" && isInitiator) {
        try {
          pc.restartIce();
        } catch {}
      }
    };

    pc.ontrack = (event) => {
      event.track.enabled = true;
      setPeers((prev) => {
        const next = new Map(prev);
        const p = next.get(targetPeerId) || {
          peerId: targetPeerId,
          userId: targetPeerId,
          name: "Participant",
          avatarUrl: "",
          role: "presenter" as AuraRole,
          isAudioMuted: false,
          isVideoMuted: false,
          isScreenSharing: false
        };
        {
          const existingTracks = p.stream ? p.stream.getTracks() : [];
          const allTracksMap = new Map<string, MediaStreamTrack>();
          existingTracks.forEach((t) => allTracksMap.set(t.id, t));
          allTracksMap.set(event.track.id, event.track);

          // Brand new MediaStream reference guarantees React re-render & triggers audio/video ref bindings immediately
          const freshStream = new MediaStream(Array.from(allTracksMap.values()));
          next.set(targetPeerId, { ...p, stream: freshStream });
        }
        return next;
      });
    };

    pc.onnegotiationneeded = async () => {
      if (!isInitiator) return;
      if (pc.signalingState !== "stable" || makingOfferRef.current.has(targetPeerId)) return;
      makingOfferRef.current.add(targetPeerId);
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
      } finally {
        makingOfferRef.current.delete(targetPeerId);
      }
    };

    return pc;
  };

  const handleRemoteSignal = async (senderPeerId: string, signal: any) => {
    if (!senderPeerId || senderPeerId === myPeerIdRef.current) return;
    let pc = peerConnectionsRef.current.get(senderPeerId);
    if (!pc) {
      const created = createPeerConnection(senderPeerId, false);
      if (!created) return;
      pc = created;
    }

    try {
      if (signal.sdp) {
        if (signal.sdp.type === "offer" && pc.signalingState !== "stable") {
          return;
        }
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

  const toggleVideo = useCallback(async () => {
    if (isVideoMuted || !cameraTrackRef.current || cameraTrackRef.current.readyState !== "live") {
      // 1. User wants to turn camera ON
      try {
        let track = cameraTrackRef.current;
        if (!track || track.readyState !== "live") {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }
          });
          track = stream.getVideoTracks()[0];
          cameraTrackRef.current = track;
        } else {
          track.enabled = true;
        }

        // If not actively screen sharing, attach camera to local display & remote peers
        if (!isScreenSharing) {
          const audioTracks = localStreamRef.current ? localStreamRef.current.getAudioTracks() : [];
          const newStream = new MediaStream([track, ...audioTracks]);
          localStreamRef.current = newStream;
          setLocalStream(newStream);
          setIsVideoMuted(false);

          peerConnectionsRef.current.forEach((pc) => {
            const sender = pc.getSenders().find((s) => s.track?.kind === "video");
            if (sender) {
              sender.replaceTrack(track);
            } else {
              pc.addTrack(track, newStream);
            }
          });

          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: "media-state",
                data: { isVideoMuted: false }
              })
            );
          }
        } else {
          // Keep screen sharing active on display, but record that camera is available
          setIsVideoMuted(false);
        }
      } catch (err) {
        console.warn("Could not start camera:", err);
        setError("Camera permission denied or camera device in use by another app.");
      }
    } else {
      // 2. User wants to turn camera OFF (stops sensor completely to turn off webcam hardware LED)
      if (cameraTrackRef.current) {
        cameraTrackRef.current.stop();
        cameraTrackRef.current = null;
      }
      setIsVideoMuted(true);

      if (!isScreenSharing) {
        const audioTracks = localStreamRef.current ? localStreamRef.current.getAudioTracks() : [];
        const audioStream = new MediaStream([...audioTracks]);
        localStreamRef.current = audioStream;
        setLocalStream(audioStream);

        peerConnectionsRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender) {
            sender.replaceTrack(null);
          }
        });

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "media-state",
              data: { isVideoMuted: true }
            })
          );
        }
      }
    }
  }, [isVideoMuted, isScreenSharing]);

  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      // 1. Stop active screen sharing
      if (screenTrackRef.current) {
        screenTrackRef.current.stop();
        screenTrackRef.current = null;
      }
      setIsScreenSharing(false);

      // 2. Check whether to restore live camera or revert to audio-only
      if (cameraTrackRef.current && cameraTrackRef.current.readyState === "live") {
        const audioTracks = localStreamRef.current ? localStreamRef.current.getAudioTracks() : [];
        const restoredCamStream = new MediaStream([cameraTrackRef.current, ...audioTracks]);
        localStreamRef.current = restoredCamStream;
        setLocalStream(restoredCamStream);
        setIsVideoMuted(false);

        peerConnectionsRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender) {
            sender.replaceTrack(cameraTrackRef.current);
          }
        });

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "media-state",
              data: { isScreenSharing: false, isVideoMuted: false }
            })
          );
        }
      } else {
        // Camera was off: remain muted
        setIsVideoMuted(true);
        const audioTracks = localStreamRef.current ? localStreamRef.current.getAudioTracks() : [];
        const audioStream = new MediaStream([...audioTracks]);
        localStreamRef.current = audioStream;
        setLocalStream(audioStream);

        peerConnectionsRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender) {
            sender.replaceTrack(null);
          }
        });

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "media-state",
              data: { isScreenSharing: false, isVideoMuted: true }
            })
          );
        }
      }
    } else {
      // 1. Start Screen Sharing (works 100% independently whether camera is ON or OFF)
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: "always" } as any,
          audio: true
        });
        const screenTrack = screenStream.getVideoTracks()[0];
        if (!screenTrack) return;

        screenTrackRef.current = screenTrack;

        // Auto-stop when user clicks browser's native "Stop sharing" bar
        screenTrack.onended = () => {
          toggleScreenShare();
        };

        // Combine screen track with microphone audio
        const audioTracks = localStreamRef.current ? localStreamRef.current.getAudioTracks() : [];
        const combinedScreenStream = new MediaStream([screenTrack, ...audioTracks]);
        localStreamRef.current = combinedScreenStream;
        setLocalStream(combinedScreenStream);
        const cameraIsAvailable = Boolean(
          cameraTrackRef.current && cameraTrackRef.current.readyState === "live"
        );
        setIsVideoMuted(!cameraIsAvailable);
        setIsScreenSharing(true);

        // Push screen video track to all peer connections (add or replace)
        peerConnectionsRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender) {
            sender.replaceTrack(screenTrack);
          } else {
            pc.addTrack(screenTrack, combinedScreenStream);
          }
        });

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "media-state",
              data: { isScreenSharing: true, isVideoMuted: !cameraIsAvailable }
            })
          );
        }
      } catch (err) {
        console.warn("Screen share cancelled or not allowed:", err);
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

  const sendChatMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || wsRef.current?.readyState !== WebSocket.OPEN) return;

      const myName = user?.name || "You";
      const myAvatar = user?.avatarUrl || "";
      const msgId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      const msgObj: ChatMessage = {
        id: msgId,
        peerId: myPeerIdRef.current,
        senderName: myName,
        senderAvatar: myAvatar,
        text: trimmed,
        time: timeStr,
        isSelf: true
      };

      setChatMessages((prev) => [...prev, msgObj]);

      wsRef.current.send(
        JSON.stringify({
          type: "chat-message",
          data: {
            id: msgId,
            text: trimmed,
            senderName: myName,
            senderAvatar: myAvatar
          }
        })
      );
    },
    [user?.name, user?.avatarUrl]
  );

  return {
    myPeerId: myPeerIdRef.current,
    role,
    isStageMember,
    localStream,
    peers: Array.from(peers.values()).filter(
      (p) =>
        p.peerId !== myPeerIdRef.current &&
        (!user?.id || p.userId !== user.id) &&
        (!user?.name || p.name !== user.name)
    ),
    audienceCount,
    totalParticipants,
    handsRaised,
    myHandRaised,
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
    promoteToStage,
    demoteToAudience,
    broadcastCaption,
    setOnCaptionReceived
  };
}
