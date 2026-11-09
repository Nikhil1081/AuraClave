import { useCallback, useEffect, useRef, useState } from "react";
import { Device } from "mediasoup-client";
import type { Consumer, Producer, RtpCapabilities, Transport } from "mediasoup-client/types";
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

interface PeerInfo {
  peerId: string;
  userId: string;
  name: string;
  avatarUrl: string;
}

interface SfuMessage {
  type: string;
  requestId?: string;
  message?: ChatMessage;
  peer?: PeerInfo;
  peers?: PeerInfo[];
  producerId?: string;
  consumer?: {
    id: string;
    producerId: string;
    kind: "audio" | "video";
    rtpParameters: unknown;
    peer: PeerInfo;
  };
  producers?: Array<{
    producerId: string;
    peer: PeerInfo;
    kind: "audio" | "video";
    source: string;
  }>;
  params?: Record<string, unknown>;
  rtpCapabilities?: RtpCapabilities;
  direction?: "send" | "recv";
  error?: string;
}

function getApiUrl(path: string): string {
  const base = getApiBase();
  return base ? `${base}${path}` : path;
}

function getSocketUrl(roomName: string): string {
  const apiUrl = getApiUrl("");
  const parsed = new URL(apiUrl || window.location.origin, window.location.origin);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/api/sfu";
  parsed.search = new URLSearchParams({
    room: roomName,
    token: localStorage.getItem("auraclave_auth_token") || ""
  }).toString();
  return parsed.toString();
}

function createRequestId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<Map<string, AuraWeavePeer>>(new Map());
  const [isAudioMuted, setIsAudioMuted] = useState(true);
  const [isVideoMuted, setIsVideoMuted] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [totalParticipants, setTotalParticipants] = useState(1);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onCaptionReceivedRef = useRef<((speaker: string, text: string) => void) | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const sendTransportRef = useRef<Transport | null>(null);
  const recvTransportRef = useRef<Transport | null>(null);
  const producersRef = useRef<Map<string, Producer>>(new Map());
  const consumersRef = useRef<Map<string, Consumer>>(new Map());
  const peerInfoRef = useRef<Map<string, PeerInfo>>(new Map());
  const peerStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const pendingRef = useRef<Map<string, (message: SfuMessage) => void>>(new Map());
  const localTracksRef = useRef<Map<string, MediaStreamTrack>>(new Map());

  const syncPeers = useCallback(() => {
    const next = new Map<string, AuraWeavePeer>();
    for (const [peerId, info] of peerInfoRef.current) {
      const stream = peerStreamsRef.current.get(peerId);
      next.set(peerId, {
        ...info,
        role: "presenter",
        stream,
        isAudioMuted: !stream?.getAudioTracks().some((track) => track.enabled),
        isVideoMuted: !stream?.getVideoTracks().some((track) => track.enabled),
        isScreenSharing: Boolean(stream?.getVideoTracks().some((track) => track.label.includes("screen")))
      });
    }
    setPeers(next);
    setTotalParticipants(peerInfoRef.current.size + 1);
  }, []);

  const request = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    return new Promise<SfuMessage>((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        reject(new Error("The meeting connection is not ready."));
        return;
      }
      const requestId = createRequestId();
      const timeout = window.setTimeout(() => {
        pendingRef.current.delete(requestId);
        reject(new Error(`SFU request timed out: ${type}`));
      }, 15000);
      pendingRef.current.set(requestId, (message) => {
        window.clearTimeout(timeout);
        if (message.type === "error") reject(new Error(message.error || "SFU request failed."));
        else resolve(message);
      });
      socket.send(JSON.stringify({ type, requestId, ...payload }));
    });
  }, []);

  const syncLocal = useCallback(() => {
    const stream = new MediaStream([...localTracksRef.current.values()]);
    setLocalStream(stream);
    setIsAudioMuted(!stream.getAudioTracks().some((track) => track.enabled));
    setIsVideoMuted(!stream.getVideoTracks().some((track) => track.enabled));
    setIsScreenSharing(Boolean(producersRef.current.get("screen")));
  }, []);

  const consumeProducer = useCallback(async (producerId: string, peer: PeerInfo) => {
    const device = deviceRef.current;
    const transport = recvTransportRef.current;
    if (!device || !transport || consumersRef.current.has(producerId)) return;
    peerInfoRef.current.set(peer.peerId, peer);
    const response = await request("consume", {
      transportId: transport.id,
      producerId,
      rtpCapabilities: device.rtpCapabilities
    });
    if (!response.consumer) return;
    const consumer = await transport.consume({
      id: response.consumer.id,
      producerId: response.consumer.producerId,
      kind: response.consumer.kind,
      rtpParameters: response.consumer.rtpParameters as never
    });
    consumersRef.current.set(producerId, consumer);
    const stream = peerStreamsRef.current.get(peer.peerId) || new MediaStream();
    stream.addTrack(consumer.track);
    peerStreamsRef.current.set(peer.peerId, stream);
    await request("resumeConsumer", { consumerId: consumer.id });
    syncPeers();
  }, [request, syncPeers]);

  const setupTransport = useCallback(async (direction: "send" | "recv") => {
    const response = await request("createTransport", { direction });
    if (!response.params) throw new Error("SFU returned incomplete transport details.");
    const device = deviceRef.current;
    if (!device) throw new Error("The mediasoup device is not ready.");
    const transport = direction === "send"
      ? device.createSendTransport(response.params as never)
      : device.createRecvTransport(response.params as never);
    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
      request("connectTransport", { transportId: transport.id, dtlsParameters })
        .then(() => callback())
        .catch((reason) => errback(reason instanceof Error ? reason : new Error("Transport connection failed.")));
    });
    if (direction === "send") {
      transport.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
        request("produce", { transportId: transport.id, kind, rtpParameters, appData })
          .then((message) => message.producerId ? callback({ id: message.producerId }) : errback(new Error("SFU did not return a producer ID.")))
          .catch((reason) => errback(reason instanceof Error ? reason : new Error("Unable to publish media.")));
      });
      sendTransportRef.current = transport;
    } else {
      recvTransportRef.current = transport;
    }
    return transport;
  }, [request]);

  useEffect(() => {
    if (!roomName || !user?.id) return;
    let active = true;
    const socket = new WebSocket(getSocketUrl(roomName));
    socketRef.current = socket;

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as SfuMessage;
      if (message.requestId) {
        pendingRef.current.get(message.requestId)?.(message);
        pendingRef.current.delete(message.requestId);
        return;
      }
      if (message.type === "joined") {
        if (message.peer) peerInfoRef.current.set(message.peer.peerId, message.peer);
        for (const peer of message.peers || []) peerInfoRef.current.set(peer.peerId, peer);
      } else if (message.type === "peerJoined" && message.peer) {
        peerInfoRef.current.set(message.peer.peerId, message.peer);
        syncPeers();
      } else if (message.type === "peerLeft" && message.peer) {
        peerInfoRef.current.delete(message.peer.peerId);
        peerStreamsRef.current.delete(message.peer.peerId);
        syncPeers();
      } else if (message.type === "newProducer" && message.producerId && message.peer) {
        void consumeProducer(message.producerId, message.peer);
      } else if (message.type === "chat" && message.message) {
        setChatMessages((previous) => [...previous, { ...message.message!, isSelf: false }]);
      } else if (message.type === "caption" && message.message) {
        onCaptionReceivedRef.current?.(message.message.senderName, message.message.text);
      } else if (message.type === "error") {
        setError(message.error || "The SFU returned an error.");
      }
    };

    socket.onopen = async () => {
      try {
        const joined = await request("getRouterRtpCapabilities");
        const device = new Device();
        await device.load({ routerRtpCapabilities: joined.rtpCapabilities! });
        deviceRef.current = device;
        await setupTransport("send");
        await setupTransport("recv");
        const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioTrack = audio.getAudioTracks()[0];
        if (audioTrack && sendTransportRef.current) {
          const producer = await sendTransportRef.current.produce({ track: audioTrack, appData: { source: "microphone" } });
          producersRef.current.set("microphone", producer);
          localTracksRef.current.set("microphone", audioTrack);
        }
        syncLocal();
        const existing = await request("getExistingProducers");
        for (const producer of existing.producers || []) {
          await consumeProducer(producer.producerId, producer.peer);
        }
        if (active) {
          setConnected(true);
          syncPeers();
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to connect to the meeting SFU.");
      }
    };
    socket.onerror = () => setError("Unable to connect to the AuraClave SFU.");

    return () => {
      active = false;
      for (const track of localTracksRef.current.values()) track.stop();
      socket.close();
      sendTransportRef.current?.close();
      recvTransportRef.current?.close();
      setConnected(false);
    };
  }, [consumeProducer, isHost, request, roomName, setupTransport, syncLocal, syncPeers, user?.id]);

  const toggleAudio = useCallback(async () => {
    const producer = producersRef.current.get("microphone");
    if (!producer) return;
    if (producer.paused) await producer.resume();
    else await producer.pause();
    setIsAudioMuted(producer.paused);
  }, []);

  const toggleVideo = useCallback(async () => {
    const existing = producersRef.current.get("camera");
    if (existing) {
      existing.close();
      producersRef.current.delete("camera");
      localTracksRef.current.get("camera")?.stop();
      localTracksRef.current.delete("camera");
      syncLocal();
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const track = stream.getVideoTracks()[0];
    if (!track || !sendTransportRef.current) return;
    const producer = await sendTransportRef.current.produce({ track, appData: { source: "camera" } });
    producersRef.current.set("camera", producer);
    localTracksRef.current.set("camera", track);
    syncLocal();
  }, [syncLocal]);

  const toggleScreenShare = useCallback(async () => {
    const existing = producersRef.current.get("screen");
    if (existing) {
      existing.close();
      producersRef.current.delete("screen");
      localTracksRef.current.get("screen")?.stop();
      localTracksRef.current.delete("screen");
      syncLocal();
      return;
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track = stream.getVideoTracks()[0];
    if (!track || !sendTransportRef.current) return;
    track.onended = () => void toggleScreenShare();
    const producer = await sendTransportRef.current.produce({ track, appData: { source: "screen" } });
    producersRef.current.set("screen", producer);
    localTracksRef.current.set("screen", track);
    syncLocal();
  }, [syncLocal]);

  const sendChatMessage = useCallback(async (text: string) => {
    const message: ChatMessage = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      peerId: user?.id || "",
      senderName: user?.name || "You",
      senderAvatar: user?.avatarUrl || "",
      text,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      isSelf: true
    };
    setChatMessages((previous) => [...previous, message]);
    socketRef.current?.send(JSON.stringify({ type: "chat", message }));
  }, [user]);

  const broadcastCaption = useCallback(async (speaker: string, text: string) => {
    socketRef.current?.send(JSON.stringify({
      type: "caption",
      message: { senderName: speaker, text }
    }));
  }, []);

  return {
    myPeerId: user?.id || "",
    role: isHost ? "host" as AuraRole : "presenter" as AuraRole,
    isStageMember: true,
    localStream,
    peers: Array.from(peers.values()),
    audienceCount: 0,
    totalParticipants,
    handsRaised: [] as HandRaisedUser[],
    myHandRaised: false,
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
    toggleRaiseHand: () => {},
    promoteToStage: () => {},
    demoteFromStage: () => {},
    setOnCaptionReceived: (callback: (speaker: string, text: string) => void) => {
      onCaptionReceivedRef.current = callback;
    },
    broadcastCaption
  };
}
