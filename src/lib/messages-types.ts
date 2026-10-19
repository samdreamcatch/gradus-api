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
    /** Set when the sender deleted their account; the body is blanked. */
    senderDeletedAt: string | null;
    createdAt: string;
  } | null;
  unreadCount: number;
  updatedAt: string;
};

export type MessageDTO = {
  id: string;
  roomId: string;
  senderUserId: string | null;
  /** Set when the sender deleted their account; the body is blanked. */
  senderDeletedAt: string | null;
  senderRole: RoleInRoom;
  senderFirstName: string;
  senderLastName: string;
  kind: "text" | "voice";
  body: string;
  audioUrl: string | null;
  durationSeconds: number | null;
  /** Server-side transcript of a voice note (PRD §6.7); null until transcribed, and always null for text. */
  transcript: string | null;
  createdAt: string;
  readBy: { userId: string; readAt: string }[];
  plan: { id: string; title: string; coachId: string | null } | null;
  /**
   * The earlier message this one answers; null when it isn't a reply or the quoted message is gone.
   * Optional in the contract: Xcode Cloud can ship an app that expects it
   * before this server is published.
   */
  replyTo?: ReplyPreview | null;
  /** One per person, oldest first; a cleared reaction is left out. */
  reactions?: MessageReaction[];
};

/** Fixed set, in picker order (one per person per message, swappable). */
export const MESSAGE_REACTIONS = ["👍", "❤️", "😂", "🔥", "👏"] as const;
export type ReactionEmoji = (typeof MESSAGE_REACTIONS)[number];

export type MessageReaction = { userId: string; emoji: ReactionEmoji };

/** Enough of the quoted message to draw the line above a reply. */
export type ReplyPreview = {
  id: string;
  senderRole: RoleInRoom;
  senderFirstName: string;
  /** Set when the quoted sender deleted their account; `excerpt` is then empty. */
  senderDeletedAt: string | null;
  kind: "text" | "voice";
  /** Up to 140 characters of the quoted text; empty for a voice note. */
  excerpt: string;
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
    /** The viewer's coach profile id, when the viewer is a coach. */
    myCoachId: string | null;
    /** Athlete rooms: the parent paused messaging with this coach (PRD §6.13 C); sends are refused both ways. */
    messagingPausedByParent: boolean;
    /**
     * Athlete rooms: why the room is closed right now, in the viewer's own
     * terms (the athlete's parent hasn't joined, a provisional or paused
     * account, a parent's pause), or null while it is open. Shown in place
     * of the composer (decision #56). Optional on the wire only so an app
     * that knows the field still decodes a room from a server published
     * without it.
     */
    messagingClosedMessage?: string | null;
    /** The viewer is an athlete under 18: text only, no voice notes (PRD §6.13 A7). */
    viewerTextOnly: boolean;
  };
  messages: MessageDTO[];
};
