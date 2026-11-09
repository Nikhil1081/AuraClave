export interface WaitingParticipant {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  status: "waiting" | "admitted" | "rejected";
  requestedAt: number;
}

export interface RoomState {
  roomName: string;
  hostId: string;
  hostName: string;
  openToAll: boolean;
  waitingRoomEnabled: boolean;
  waitingList: Map<string, WaitingParticipant>;
  createdAt: number;
}

const rooms = new Map<string, RoomState>();

export function getOrCreateRoom(roomName: string, hostUser?: { id: string; name: string }): RoomState {
  let room = rooms.get(roomName);
  if (!room) {
    room = {
      roomName,
      hostId: hostUser?.id || "",
      hostName: hostUser?.name || "Host",
      openToAll: true, // Default open to all, can be toggled by host!
      waitingRoomEnabled: false,
      waitingList: new Map(),
      createdAt: Date.now()
    };
    rooms.set(roomName, room);
  } else if (!room.hostId && hostUser) {
    room.hostId = hostUser.id;
    room.hostName = hostUser.name;
  }
  return room;
}

export function getRoom(roomName: string): RoomState | undefined {
  return rooms.get(roomName);
}

export function requestToJoin(
  roomName: string,
  user: { id: string; name: string; email: string; avatarUrl?: string }
): { status: "admitted" | "waiting" | "rejected"; isHost: boolean } {
  let room = rooms.get(roomName);

  // If room doesn't exist, this first user is the host!
  if (!room) {
    room = getOrCreateRoom(roomName, { id: user.id, name: user.name });
    return { status: "admitted", isHost: true };
  }

  // Host is always admitted
  if (room.hostId === user.id) {
    return { status: "admitted", isHost: true };
  }

  // If room is open to all or waiting room is disabled, admit immediately
  if (room.openToAll || !room.waitingRoomEnabled) {
    return { status: "admitted", isHost: false };
  }

  // Check existing status in waiting list
  const existing = room.waitingList.get(user.id);
  if (existing) {
    return { status: existing.status, isHost: false };
  }

  // Add to waiting list
  const waitingUser: WaitingParticipant = {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    status: "waiting",
    requestedAt: Date.now()
  };
  room.waitingList.set(user.id, waitingUser);

  return { status: "waiting", isHost: false };
}

export function checkAdmission(roomName: string, userId: string): { status: "admitted" | "waiting" | "rejected"; isHost: boolean } {
  const room = rooms.get(roomName);
  if (!room) return { status: "admitted", isHost: false };

  if (room.hostId === userId) return { status: "admitted", isHost: true };
  if (room.openToAll || !room.waitingRoomEnabled) return { status: "admitted", isHost: false };

  const participant = room.waitingList.get(userId);
  if (!participant) return { status: "waiting", isHost: false };

  return { status: participant.status, isHost: false };
}

export function setAdmissionDecision(
  roomName: string,
  hostId: string,
  participantId: string,
  decision: "admit" | "reject"
): boolean {
  const room = rooms.get(roomName);
  if (!room || room.hostId !== hostId) return false;

  const participant = room.waitingList.get(participantId);
  if (!participant) return false;

  participant.status = decision === "admit" ? "admitted" : "rejected";
  return true;
}

export function updateRoomSettings(
  roomName: string,
  hostId: string,
  settings: { openToAll?: boolean; waitingRoomEnabled?: boolean }
): RoomState | null {
  const room = rooms.get(roomName);
  if (!room || room.hostId !== hostId) return null;

  if (typeof settings.openToAll === "boolean") {
    room.openToAll = settings.openToAll;
    if (settings.openToAll) {
      // If set to open to all, automatically admit everyone waiting!
      room.waitingList.forEach(p => {
        if (p.status === "waiting") p.status = "admitted";
      });
    }
  }

  if (typeof settings.waitingRoomEnabled === "boolean") {
    room.waitingRoomEnabled = settings.waitingRoomEnabled;
    if (!settings.waitingRoomEnabled) {
      room.waitingList.forEach(p => {
        if (p.status === "waiting") p.status = "admitted";
      });
    }
  }

  return room;
}

export function getWaitingList(roomName: string, hostId: string): WaitingParticipant[] {
  const room = rooms.get(roomName);
  if (!room || room.hostId !== hostId) return [];

  return Array.from(room.waitingList.values()).filter(p => p.status === "waiting");
}
