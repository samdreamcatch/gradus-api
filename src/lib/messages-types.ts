export type RoleInRoom = "coach" | "athlete" | "parent";

export type RoomKind = "athlete" | "coach_coach" | "coach_parent";

export type RoomParticipant = {
  userId: string | null;
  role: RoleInRoom;
  firstName: string;
  lastName: string;
};

export type RoomSummary = {
  id: string;
  kind: RoomKind;
  /** Populated for kind="athlete" only. */
  coachId: string | null;
  /** Populated for kind="athlete" only. */
  athleteId: string | null;
  participants: RoomParticipant[];
  myRole: RoleInRoom;
  myUserId: string;
  lastMessage: {
    id: string;
    kind: "text" | "voice";
    body: string;
    senderRole: RoleInRoom;
    senderFirstName: string;
    createdAt: string;
  } | null;
  unreadCount: number;
  updatedAt: string;
};

export type MessageDTO = {
  id: string;
  roomId: string;
  senderUserId: string;
  senderRole: RoleInRoom;
  senderFirstName: string;
  senderLastName: string;
  kind: "text" | "voice";
  body: string;
  audioUrl: string | null;
  durationSeconds: number | null;
  createdAt: string;
  readBy: { userId: string; readAt: string }[];
  plan: { id: string; title: string } | null;
};

export type RoomDetail = {
  room: {
    id: string;
    kind: RoomKind;
    coachId: string | null;
    athleteId: string | null;
    participants: RoomParticipant[];
    myRole: RoleInRoom;
    myUserId: string;
  };
  messages: MessageDTO[];
};
