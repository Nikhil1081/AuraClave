import { useEffect, useRef, useState, useCallback } from "react";
import { getApiBase } from "./auth";

export interface AuraWeavePeer {
  peerId: string;
  userId: string;
  name: string;
  avatarUrl: string;
  stream?: MediaStream;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  isScreenSharing: boolean;
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
  user
}: {
  roomName: string;
  user: { id: string; name: string; avatarUrl?: string } | null;
}) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<Map<string, AuraWeavePeer>>(new Map());
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

  // 1. Initialize Local Camera and Microphone
  useEffect(() => {
    let active = true;

    async function initMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user"
          }
        });

        if (!active) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        localStreamRef.current = stream;
        cameraTrackRef.current = stream.getVideoTracks()[0] || null;
        setLocalStream(stream);
      } catch (err: any) {
        console.warn("Could not acquire video & audio, falling back to audio only:", err);
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (!active) {
            audioStream.getTracks().forEach(t => t.stop());
            return;
          }
          localStreamRef.current = audioStream;
          setIsVideoMuted(true);
          setLocalStream(audioStream);
        } catch (audioErr: any) {
          console.error("No media devices accessible:", audioErr);
          setError("Microphone/camera access denied. You can still join to listen.");
        }
      }
    }

    initMedia();

    return () => {
      active = false;
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
      }
    };
  }, []);

  // 2. Connect to AuraWeave Signaling Server
  useEffect(() => {
    if (!roomName || !user?.id) return;

    const wsUrl = getAuraWeaveWsUrl();
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);

      // Join room with user metadata
      ws.send(
        JSON.stringify({
          type: "join",
          data: {
            roomName,
            userId: user.id,
            name: user.name || "Guest",
            avatarUrl: user.avatarUrl || ""
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

            // Existing peers in the room: initiate polite WebRTC connections to each
            const existingPeers: any[] = data.peers || [];
            existingPeers.forEach((p) => {
              addPeerState(p);
              createPeerConnection(p.peerId, true); // We initiate offer to existing peers
            });
            break;
          }

          case "peer-joined": {
            // New peer joined after us
            addPeerState(data);
            createPeerConnection(data.peerId, false); // Wait for their offer
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

          case "peer-left": {
            removePeer(data.peerId);
            break;
          }
        }
      } catch (err) {
        console.error("AuraWeave message handling error:", err);
      }
    };

    ws.onerror = (err) => {
      console.warn("AuraWeave WebSocket error:", err);
    };

    ws.onclose = () => {
      setConnected(false);
    };

    // Ping every 20 seconds to prevent timeout
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
  }, [roomName, user?.id]);

  const addPeerState = (peer: AuraWeavePeer) => {
    setPeers((prev) => {
      const next = new Map(prev);
      next.set(peer.peerId, { ...peer });
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

    // Add local tracks to peer connection
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    // Handle ICE candidates
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

    // Handle incoming remote media tracks
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

    // Polite negotiation handling
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

        // Flush any queued ICE candidates for this peer
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
          // Queue candidate until remote description is ready
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
      // Revert to camera
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
      // Start Screen Share
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

        // Replace outgoing video track on all peer connections
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

  return {
    localStream,
    peers: Array.from(peers.values()),
    isAudioMuted,
    isVideoMuted,
    isScreenSharing,
    connected,
    error,
    toggleAudio,
    toggleVideo,
    toggleScreenShare
  };
}
