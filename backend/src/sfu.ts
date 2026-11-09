import type { Server as HttpServer } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import * as mediasoup from "mediasoup";
import type {
  Consumer,
  Producer,
  Router,
  WebRtcTransport,
  Worker
} from "mediasoup/types";
import { getAuthenticatedUserFromToken } from "./auth.js";

type JsonRecord = Record<string, unknown>;

interface Peer {
  id: string;
  name: string;
  avatarUrl: string;
  socket: WebSocket;
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
}

interface Room {
  router: Router;
  peers: Map<string, Peer>;
}

const rooms = new Map<string, Room>();
let worker: Worker | undefined;

const mediaCodecs: mediasoup.types.RtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
    preferredPayloadType: 111
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    preferredPayloadType: 96,
    parameters: {}
  },
  {
    kind: "video",
    mimeType: "video/h264",
    clockRate: 90000,
    preferredPayloadType: 97,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42e01f",
      "level-asymmetry-allowed": 1
    }
  }
];

function send(socket: WebSocket, type: string, payload: JsonRecord = {}) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type, ...payload }));
  }
}

function broadcast(room: Room, type: string, payload: JsonRecord, except?: string) {
  for (const peer of room.peers.values()) {
    if (peer.id !== except) send(peer.socket, type, payload);
  }
}

function roomPeer(peer: Peer) {
  return { peerId: peer.id, userId: peer.id, name: peer.name, avatarUrl: peer.avatarUrl };
}

async function getRoom(roomName: string): Promise<Room> {
  const existing = rooms.get(roomName);
  if (existing) return existing;
  if (!worker) throw new Error("SFU worker is not ready.");
  const router = await worker.createRouter({ mediaCodecs });
  const room = { router, peers: new Map<string, Peer>() };
  rooms.set(roomName, room);
  return room;
}

async function createTransport(router: Router): Promise<WebRtcTransport> {
  const listenIp = process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0";
  const announcedIp = process.env.MEDIASOUP_ANNOUNCED_IP;
  if (listenIp === "0.0.0.0" && !announcedIp) {
    throw new Error("MEDIASOUP_ANNOUNCED_IP must be configured for remote participants.");
  }
  return router.createWebRtcTransport({
    listenInfos: [{
      protocol: "udp",
      ip: listenIp,
      announcedAddress: announcedIp,
      portRange: {
        min: Number(process.env.MEDIASOUP_MIN_PORT || 40000),
        max: Number(process.env.MEDIASOUP_MAX_PORT || 49999)
      }
    }, {
      protocol: "tcp",
      ip: listenIp,
      announcedAddress: announcedIp,
      portRange: {
        min: Number(process.env.MEDIASOUP_MIN_PORT || 40000),
        max: Number(process.env.MEDIASOUP_MAX_PORT || 49999)
      }
    }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1_000_000
  });
}

async function handleMessage(peer: Peer, room: Room, raw: string) {
  const message = JSON.parse(raw) as JsonRecord;
  const type = typeof message.type === "string" ? message.type : "";

  if (type === "getRouterRtpCapabilities") {
    send(peer.socket, "routerRtpCapabilities", { rtpCapabilities: room.router.rtpCapabilities });
    return;
  }

  if (type === "createTransport") {
    const transport = await createTransport(room.router);
    peer.transports.set(transport.id, transport);
    transport.on("dtlsstatechange", (state) => {
      if (state === "closed") transport.close();
    });
    send(peer.socket, "transportCreated", {
      requestId: message.requestId,
      direction: message.direction,
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
        sctpParameters: transport.sctpParameters
      }
    });
    return;
  }

  if (type === "connectTransport") {
    const transport = peer.transports.get(String(message.transportId));
    if (!transport) throw new Error("Transport not found.");
    await transport.connect({ dtlsParameters: message.dtlsParameters as mediasoup.types.DtlsParameters });
    send(peer.socket, "transportConnected", { requestId: message.requestId });
    return;
  }

  if (type === "produce") {
    const transport = peer.transports.get(String(message.transportId));
    if (!transport) throw new Error("Transport not found.");
    const producer = await transport.produce({
      kind: message.kind as "audio" | "video",
      rtpParameters: message.rtpParameters as mediasoup.types.RtpParameters,
      appData: (message.appData as JsonRecord) || {}
    });
    peer.producers.set(producer.id, producer);
    producer.on("transportclose", () => peer.producers.delete(producer.id));
    send(peer.socket, "produced", { requestId: message.requestId, producerId: producer.id });
    broadcast(room, "newProducer", {
      producerId: producer.id,
      peer: roomPeer(peer),
      kind: producer.kind,
      source: (producer.appData as JsonRecord).source || producer.kind
    }, peer.id);
    return;
  }

  if (type === "getExistingProducers") {
    const producers = [...room.peers.values()]
      .filter((other) => other.id !== peer.id)
      .flatMap((other) => [...other.producers.values()].map((producer) => ({
        producerId: producer.id,
        peer: roomPeer(other),
        kind: producer.kind,
        source: (producer.appData as JsonRecord).source || producer.kind
      })));
    send(peer.socket, "existingProducers", { producers });
    return;
  }

  if (type === "consume") {
    const producer = [...room.peers.values()]
      .flatMap((other) => [...other.producers.values()])
      .find((candidate) => candidate.id === message.producerId);
    const transport = peer.transports.get(String(message.transportId));
    if (!producer || !transport) throw new Error("Producer or transport not found.");
    if (!room.router.canConsume({
      producerId: producer.id,
      rtpCapabilities: message.rtpCapabilities as mediasoup.types.RtpCapabilities
    })) {
      throw new Error("This browser cannot consume the requested media.");
    }
    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities: message.rtpCapabilities as mediasoup.types.RtpCapabilities,
      paused: true
    });
    peer.consumers.set(consumer.id, consumer);
    consumer.on("transportclose", () => peer.consumers.delete(consumer.id));
    send(peer.socket, "consumerCreated", {
      requestId: message.requestId,
      consumer: {
        id: consumer.id,
        producerId: producer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        peer: roomPeer([...room.peers.values()].find((candidate) => candidate.producers.has(producer.id))!)
      }
    });
    return;
  }

  if (type === "resumeConsumer") {
    const consumer = peer.consumers.get(String(message.consumerId));
    if (!consumer) throw new Error("Consumer not found.");
    await consumer.resume();
    return;
  }

  if (type === "chat" || type === "caption") {
    broadcast(room, type, { message: message.message, peer: roomPeer(peer) }, peer.id);
  }
}

export async function attachSfu(server: HttpServer) {
  worker = await mediasoup.createWorker({
    logLevel: "warn",
    rtcMinPort: Number(process.env.MEDIASOUP_MIN_PORT || 40000),
    rtcMaxPort: Number(process.env.MEDIASOUP_MAX_PORT || 49999)
  });
  worker.on("died", () => {
    console.error("mediasoup worker died; stopping the API so the process manager can restart it.");
    setTimeout(() => process.exit(1), 1000);
  });

  const wss = new WebSocketServer({ server, path: "/api/sfu" });
  wss.on("connection", (socket, request) => {
    const token = new URL(request.url || "", "http://localhost").searchParams.get("token");
    const roomName = new URL(request.url || "", "http://localhost").searchParams.get("room");
    if (!token || !roomName) {
      socket.close(1008, "Authentication and room are required.");
      return;
    }

    void getAuthenticatedUserFromToken(token).then(async (user) => {
      const room = await getRoom(roomName);
      const peer: Peer = {
        id: user.id,
        name: user.user_metadata.full_name || user.email,
        avatarUrl: user.user_metadata.avatar_url || "",
        socket,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      };
      room.peers.set(peer.id, peer);
      send(socket, "joined", {
        peer: roomPeer(peer),
        peers: [...room.peers.values()].filter((other) => other.id !== peer.id).map(roomPeer)
      });
      broadcast(room, "peerJoined", { peer: roomPeer(peer) }, peer.id);

      socket.on("message", (data) => {
        void handleMessage(peer, room, data.toString()).catch((error: unknown) => {
          send(socket, "error", {
            message: error instanceof Error ? error.message : "SFU request failed."
          });
        });
      });
      socket.on("close", () => {
        for (const consumer of peer.consumers.values()) consumer.close();
        for (const producer of peer.producers.values()) producer.close();
        for (const transport of peer.transports.values()) transport.close();
        room.peers.delete(peer.id);
        broadcast(room, "peerLeft", { peer: { peerId: peer.id } });
        if (room.peers.size === 0) {
          room.router.close();
          rooms.delete(roomName);
        }
      });
    }).catch(() => socket.close(1008, "Invalid authentication token."));
  });
}
