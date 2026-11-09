import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";

export type AuraRole = "host" | "presenter" | "audience";

export interface AuraWeaveParticipant {
  ws: WebSocket;
  peerId: string;
  userId: string;
  name: string;
  avatarUrl: string;
  roomName: string;
  role: AuraRole;
  raisedHand: boolean;
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
              const { roomName, userId, name, avatarUrl, isHost } = data;
              if (!roomName || !userId) return;

              currentRoomName = roomName;
              currentPeerId = `${userId}_${Math.random().toString(36).slice(2, 7)}`;

              if (!this.rooms.has(roomName)) {
                this.rooms.set(roomName, new Map());
              }

              const room = this.rooms.get(roomName)!;

              // Clean up any stale connection for this exact same user
              room.forEach((oldP, oldPeerId) => {
                if (oldP.userId === userId) {
                  try {
                    oldP.ws.close();
                  } catch {}
                  room.delete(oldPeerId);
                  this.broadcast(roomName, oldPeerId, {
                    type: "peer-left",
                    data: { peerId: oldPeerId }
                  });
                }
              });

              const isFirst = room.size === 0;

              // Everyone has full speaking, video, and screen share permissions.
              const assignedRole: AuraRole = isHost || isFirst ? "host" : "presenter";

              const participant: AuraWeaveParticipant = {
                ws,
                peerId: currentPeerId,
                userId,
                name: name || "Guest",
                avatarUrl: avatarUrl || "",
                roomName,
                role: assignedRole,
                raisedHand: false,
                isAudioMuted: false,
                isVideoMuted: false,
                isScreenSharing: false,
                lastPing: Date.now()
              };

              room.set(currentPeerId, participant);

              // Every connected participant is a regular two-way meeting peer.
              const stageMembers: any[] = [];
              const handsRaised: any[] = [];

              room.forEach((p) => {
                if (p.peerId !== currentPeerId && p.userId !== userId) {
                  stageMembers.push({
                    peerId: p.peerId,
                    userId: p.userId,
                    name: p.name,
                    avatarUrl: p.avatarUrl,
                    role: p.role,
                    isAudioMuted: p.isAudioMuted,
                    isVideoMuted: p.isVideoMuted,
                    isScreenSharing: p.isScreenSharing
                  });
                }

                if (p.peerId !== currentPeerId && p.userId !== userId && p.raisedHand) {
                  handsRaised.push({
                    peerId: p.peerId,
                    userId: p.userId,
                    name: p.name,
                    avatarUrl: p.avatarUrl
                  });
                }
              });

              // 1. Reply to joining participant
              this.send(ws, {
                type: "joined",
                data: {
                  peerId: currentPeerId,
                  role: assignedRole,
                  stageMembers,
                  totalAudience: 0,
                  totalRoomMembers: room.size,
                  handsRaised
                }
              });

              // 2. Broadcast updated room status and presence to all participants
              this.broadcastRoomSummary(roomName);

              // 3. Notify all existing peers so they create a two-way connection.
              this.broadcast(roomName, currentPeerId, {
                type: "stage-member-added",
                data: {
                  peerId: currentPeerId,
                  userId: participant.userId,
                  name: participant.name,
                  avatarUrl: participant.avatarUrl,
                  role: assignedRole
                }
              });
              break;
            }

            case "signal": {
              // Direct WebRTC SDP offer, answer, or ICE candidate routing
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

            case "raise-hand": {
              // Audience member raises or lowers hand
              const { raised } = data;
              const room = this.rooms.get(currentRoomName);
              const me = room?.get(currentPeerId);
              if (me) {
                me.raisedHand = Boolean(raised);
                this.broadcastRoomSummary(currentRoomName);
              }
              break;
            }

            case "promote-to-stage": {
              // Host promotes an audience member to presenter
              const { targetPeerId } = data;
              const room = this.rooms.get(currentRoomName);
              const me = room?.get(currentPeerId);
              const target = room?.get(targetPeerId);

              if (me?.role === "host" && target) {
                target.role = "presenter";
                target.raisedHand = false;
                target.isAudioMuted = false;
                target.isVideoMuted = false;

                // Notify target directly
                this.send(target.ws, {
                  type: "role-changed",
                  data: { role: "presenter" }
                });

                this.broadcastRoomSummary(currentRoomName);
              }
              break;
            }

            case "demote-to-audience": {
              // Host returns presenter to audience
              const { targetPeerId } = data;
              const room = this.rooms.get(currentRoomName);
              const me = room?.get(currentPeerId);
              const target = room?.get(targetPeerId);

              if (me?.role === "host" && target && target.role !== "host") {
                target.role = "audience";
                target.isAudioMuted = true;
                target.isVideoMuted = true;
                target.isScreenSharing = false;

                this.send(target.ws, {
                  type: "role-changed",
                  data: { role: "audience" }
                });

                this.broadcastRoomSummary(currentRoomName);
              }
              break;
            }

            case "media-state": {
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

            case "caption-broadcast": {
              // Broadcast live closed captions to all 1,000 participants
              if (!currentRoomName) return;
              this.broadcast(currentRoomName, currentPeerId, {
                type: "live-caption",
                data: {
                  speaker: data.speaker,
                  text: data.text,
                  time: data.time || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                }
              });
              break;
            }

            case "chat-message": {
              // Broadcast real-time text chat messages across all participants
              if (!currentRoomName) return;
              const { text, senderName, senderAvatar, id } = data || {};
              if (!text || !text.trim()) return;

              const chatPayload = {
                id: id || `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                peerId: currentPeerId,
                senderName: senderName || "Guest",
                senderAvatar: senderAvatar || "",
                text: text.trim().slice(0, 1000),
                time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              };

              this.broadcast(currentRoomName, currentPeerId, {
                type: "chat-message",
                data: chatPayload
              });
              break;
            }

            case "ping": {
              this.send(ws, { type: "pong", data: { time: Date.now() } });
              break;
            }
          }
        } catch (err) {
          console.error("AuraWeave broadcast error:", err);
        }
      });

      ws.on("close", () => {
        this.removeParticipant(currentRoomName, currentPeerId);
      });

      ws.on("error", () => {
        this.removeParticipant(currentRoomName, currentPeerId);
      });
    });

    // Heartbeat cleanup every 25 seconds
    setInterval(() => {
      this.rooms.forEach((room, roomName) => {
        room.forEach((p, peerId) => {
          if (p.ws.readyState !== WebSocket.OPEN) {
            this.removeParticipant(roomName, peerId);
          }
        });
      });
    }, 25000);
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

  private broadcastRoomSummary(roomName: string) {
    const room = this.rooms.get(roomName);
    if (!room) return;

    const stageMembers: any[] = [];
    const handsRaised: any[] = [];

    room.forEach((p) => {
      stageMembers.push({
        peerId: p.peerId,
        userId: p.userId,
        name: p.name,
        avatarUrl: p.avatarUrl,
        role: p.role,
        isAudioMuted: p.isAudioMuted,
        isVideoMuted: p.isVideoMuted,
        isScreenSharing: p.isScreenSharing
      });

      if (p.raisedHand) {
        handsRaised.push({
          peerId: p.peerId,
          userId: p.userId,
          name: p.name,
          avatarUrl: p.avatarUrl
        });
      }
    });

    const summary = {
      type: "room-summary",
      data: {
        stageMembers,
        audienceCount: 0,
        totalParticipants: room.size,
        handsRaised
      }
    };

    room.forEach((p) => {
      if (p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(JSON.stringify(summary));
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
        this.broadcastRoomSummary(roomName);
      }
    }
  }
}
