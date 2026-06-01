export type RoleInRoom = "coach" | "athlete" | "parent";

export type RoomParticipant = {
  userId: string | null;
  role: RoleInRoom;
  firstName: string;
  lastName: string;
};

export type RoomSummary = {
  id: string;
  coachId: string;
  athleteId: string;
  participants: RoomParticipant[];
  myRole: RoleInRoom;
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
};

export type RoomDetail = {
  room: {
    id: string;
    coachId: string;
    athleteId: string;
    participants: RoomParticipant[];
    myRole: RoleInRoom;
    myUserId: string;
  };
  messages: MessageDTO[];
};
