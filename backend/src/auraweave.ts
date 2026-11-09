import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";

export interface AuraWeaveParticipant {
  ws: WebSocket;
  peerId: string;
  userId: string;
  name: string;
  avatarUrl: string;
  roomName: string;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  isScreenSharing: boolean;
  lastPing: number;
}

export class AuraWeaveSignaler {
  private wss: WebSocketServer;
  private rooms = new Map<string, Map<string, AuraWeaveParticipant>>();

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({ server, path: "/auraweave" });

    this.wss.on("connection", (ws: WebSocket) => {
      let currentPeerId = "";
      let currentRoomName = "";

      ws.on("message", (raw: string | Buffer) => {
        try {
          const message = JSON.parse(raw.toString());
          const { type, data } = message;

          switch (type) {
            case "join": {
              const { roomName, userId, name, avatarUrl } = data;
              if (!roomName || !userId) return;

              currentRoomName = roomName;
              currentPeerId = `${userId}_${Math.random().toString(36).slice(2, 7)}`;

              if (!this.rooms.has(roomName)) {
                this.rooms.set(roomName, new Map());
              }

              const room = this.rooms.get(roomName)!;

              const participant: AuraWeaveParticipant = {
                ws,
                peerId: currentPeerId,
                userId,
                name: name || "Guest",
                avatarUrl: avatarUrl || "",
                roomName,
                isAudioMuted: false,
                isVideoMuted: false,
                isScreenSharing: false,
                lastPing: Date.now()
              };

              // Collect existing participants to send to the newly joined peer
              const existingPeers = Array.from(room.values()).map(p => ({
                peerId: p.peerId,
                userId: p.userId,
                name: p.name,
                avatarUrl: p.avatarUrl,
                isAudioMuted: p.isAudioMuted,
                isVideoMuted: p.isVideoMuted,
                isScreenSharing: p.isScreenSharing
              }));

              room.set(currentPeerId, participant);

              // 1. Reply to joining peer with their assigned peerId and list of other peers
              this.send(ws, {
                type: "joined",
                data: {
                  peerId: currentPeerId,
                  peers: existingPeers
                }
              });

              // 2. Notify other peers in this room that a new peer joined
              this.broadcast(roomName, currentPeerId, {
                type: "peer-joined",
                data: {
                  peerId: currentPeerId,
                  userId: participant.userId,
                  name: participant.name,
                  avatarUrl: participant.avatarUrl,
                  isAudioMuted: false,
                  isVideoMuted: false,
                  isScreenSharing: false
                }
              });
              break;
            }

            case "signal": {
              // Route SDP offers, answers, and ICE candidates directly to targetPeerId
              const { targetPeerId, signal } = data;
              if (!targetPeerId || !currentRoomName) return;

              const room = this.rooms.get(currentRoomName);
              const target = room?.get(targetPeerId);

              if (target && target.ws.readyState === WebSocket.OPEN) {
                this.send(target.ws, {
                  type: "signal",
                  data: {
                    senderPeerId: currentPeerId,
                    signal
                  }
                });
              }
              break;
            }

            case "media-state": {
              // Broadcast mute/camera/screen states to other peers
              const { isAudioMuted, isVideoMuted, isScreenSharing } = data;
              if (!currentRoomName) return;

              const room = this.rooms.get(currentRoomName);
              const me = room?.get(currentPeerId);
              if (me) {
                if (typeof isAudioMuted === "boolean") me.isAudioMuted = isAudioMuted;
                if (typeof isVideoMuted === "boolean") me.isVideoMuted = isVideoMuted;
                if (typeof isScreenSharing === "boolean") me.isScreenSharing = isScreenSharing;

                this.broadcast(currentRoomName, currentPeerId, {
                  type: "peer-media-state",
                  data: {
                    peerId: currentPeerId,
                    isAudioMuted: me.isAudioMuted,
                    isVideoMuted: me.isVideoMuted,
                    isScreenSharing: me.isScreenSharing
                  }
                });
              }
              break;
            }

            case "ping": {
              this.send(ws, { type: "pong", data: { time: Date.now() } });
              break;
            }
          }
        } catch (err) {
          console.error("AuraWeave signal error:", err);
        }
      });

      ws.on("close", () => {
        this.removeParticipant(currentRoomName, currentPeerId);
      });

      ws.on("error", () => {
        this.removeParticipant(currentRoomName, currentPeerId);
      });
    });

    // Heartbeat cleanup every 30 seconds
    setInterval(() => {
      this.rooms.forEach((room, roomName) => {
        room.forEach((p, peerId) => {
          if (p.ws.readyState !== WebSocket.OPEN) {
            this.removeParticipant(roomName, peerId);
          }
        });
      });
    }, 30000);
  }

  private send(ws: WebSocket, payload: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  private broadcast(roomName: string, senderPeerId: string, payload: any) {
    const room = this.rooms.get(roomName);
    if (!room) return;

    room.forEach((participant, peerId) => {
      if (peerId !== senderPeerId && participant.ws.readyState === WebSocket.OPEN) {
        participant.ws.send(JSON.stringify(payload));
      }
    });
  }

  private removeParticipant(roomName: string, peerId: string) {
    if (!roomName || !peerId) return;
    const room = this.rooms.get(roomName);
    if (room && room.has(peerId)) {
      room.delete(peerId);
      if (room.size === 0) {
        this.rooms.delete(roomName);
      } else {
        this.broadcast(roomName, peerId, {
          type: "peer-left",
          data: { peerId }
        });
      }
    }
  }
}
