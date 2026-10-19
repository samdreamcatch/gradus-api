import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import {
  decodeCursor,
  encodeCursor,
  isReactionEmoji,
  missingLateColumn,
  newMessagePush,
  partitionByKind,
  roomClosedMessage,
  roomsDigest,
  REPLY_EXCERPT_MAX,
  sendMessageBody,
  setReactionBody,
  toMessageDTO,
  toReplyPreview,
  type InternalRoomRow,
} from "./messages.server";
import type { RoomParticipant, RoomSummary } from "./messages-types";

describe("page cursors", () => {
  it("round-trip and are opaque, URL-safe strings", () => {
    const cursor = encodeCursor(
      "2026-09-05T21:16:35.374+00:00",
      "8c1e2a60-1b2c-4d3e-9f00-000000000001",
    );
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual({
      createdAt: "2026-09-05T21:16:35.374+00:00",
      id: "8c1e2a60-1b2c-4d3e-9f00-000000000001",
    });
  });

  it("reject garbage with a 400 validation_failed", () => {
    for (const bad of [
      "",
      "not-base64!",
      Buffer.from("{}").toString("base64url"),
      Buffer.from('{"c":"nope","i":"x"}').toString("base64url"),
    ]) {
      let caught: unknown;
      try {
        decodeCursor(bad);
      } catch (err) {
        caught = err;
      }
      expect(caught instanceof ApiError).toBe(true);
      expect((caught as ApiError).status).toBe(400);
      expect((caught as ApiError).code).toBe("validation_failed");
    }
  });
});

describe("roomsDigest", () => {
  const room = (over: Partial<RoomSummary>): RoomSummary => ({
    id: "r1",
    kind: "athlete",
    coachId: "c1",
    athleteId: "a1",
    participants: [],
    myRole: "coach",
    myUserId: "u1",
    lastMessage: null,
    unreadCount: 0,
    updatedAt: "2026-09-05T00:00:00Z",
    ...over,
  });

  it("is stable for the same list and changes when what the list shows changes", () => {
    const a = roomsDigest([room({}), room({ id: "r2" })]);
    expect(a).toBe(roomsDigest([room({}), room({ id: "r2" })]));
    expect(a).toMatch(/^2\.[0-9a-f]{8}$/);
    expect(roomsDigest([room({ unreadCount: 1 }), room({ id: "r2" })])).not.toBe(a);
    expect(roomsDigest([room({ updatedAt: "2026-09-06T00:00:00Z" }), room({ id: "r2" })])).not.toBe(
      a,
    );
    expect(roomsDigest([room({})])).not.toBe(a);
    expect(roomsDigest([])).toBe("0.811c9dc5");
  });
});

describe("toMessageDTO", () => {
  const participants: RoomParticipant[] = [
    { userId: "coach-u", role: "coach", firstName: "Linnea", lastName: "C" },
    { userId: "ath-u", role: "athlete", firstName: "Maeve", lastName: "A" },
  ];
  const base = {
    id: "m1",
    room_id: "r1",
    direct_room_id: null,
    sender_user_id: "coach-u",
    sender_deleted_at: null,
    sender_role: "coach",
    kind: "text",
    body: "hi",
    audio_url: null,
    duration_seconds: null,
    created_at: "2026-09-05T10:00:00Z",
    plan_id: null,
  };

  it("resolves the sender by user id, then by role", () => {
    const dto = toMessageDTO(base, "r1", participants, [], null, null);
    expect(dto.senderFirstName).toBe("Linnea");
    expect(dto.roomId).toBe("r1");
    expect(dto.senderDeletedAt).toBeNull();
    const byRole = toMessageDTO(
      { ...base, sender_user_id: "someone-else", sender_role: "athlete" },
      "r1",
      participants,
      [],
      null,
      null,
    );
    // transcript: only voice notes carry one, and an empty transcript reads as none
    expect(
      toMessageDTO(
        { ...base, kind: "text", transcript: "ignored" },
        "r1",
        participants,
        [],
        null,
        null,
      ).transcript,
    ).toBeNull();
    expect(
      toMessageDTO({ ...base, kind: "voice", transcript: "" }, "r1", participants, [], null, null)
        .transcript,
    ).toBeNull();
    expect(
      toMessageDTO(
        { ...base, kind: "voice", transcript: "Nice loop." },
        "r1",
        participants,
        [],
        null,
        null,
      ).transcript,
    ).toBe("Nice loop.");
    expect(byRole.senderFirstName).toBe("Maeve");
  });

  it("blanks a deleted sender and stamps senderDeletedAt from the message", () => {
    const dto = toMessageDTO({ ...base, sender_user_id: null }, "r1", participants, [], null, null);
    expect(dto.senderUserId).toBeNull();
    expect(dto.senderFirstName).toBe("");
    expect(dto.senderDeletedAt).toBe("2026-09-05T10:00:00Z");
  });

  it("carries reads, plan tags, signed audio, and falls back to the room id", () => {
    const dto = toMessageDTO(
      {
        ...base,
        room_id: null,
        direct_room_id: null,
        kind: "voice",
        body: null,
        audio_url: "r1/u/x.m4a",
        duration_seconds: 12,
        plan_id: "p1",
      },
      "fallback",
      participants,
      [{ userId: "ath-u", readAt: "2026-09-05T10:01:00Z" }],
      { id: "p1", title: "Warm-up", coachId: "c1" },
      "https://signed",
    );
    expect(dto.roomId).toBe("fallback");
    expect(dto.kind).toBe("voice");
    expect(dto.body).toBe("");
    expect(dto.audioUrl).toBe("https://signed");
    expect(dto.durationSeconds).toBe(12);
    expect(dto.readBy.length).toBe(1);
    expect(dto.plan?.title).toBe("Warm-up");
  });
});

describe("partitionByKind", () => {
  it("splits athlete rooms from direct rooms", () => {
    const row = (id: string, kind: InternalRoomRow["kind"]): InternalRoomRow => ({
      id,
      kind,
      updatedAt: "",
      coachId: null,
      athleteId: null,
      coachAId: null,
      coachBId: null,
      directCoachId: null,
      directParentId: null,
      userA: null,
      userB: null,
    });
    expect(
      partitionByKind([row("a", "athlete"), row("b", "coach_coach"), row("c", "coach_parent")]),
    ).toEqual({
      athleteRoomIds: ["a"],
      directRoomIds: ["b", "c"],
    });
  });
});

describe("newMessagePush (sendMessage's push, decision #54)", () => {
  const sender = { firstName: "Linnea", lastName: "Corwin" };

  it("carries the Reply category and opens the room", () => {
    expect(newMessagePush("r1", "coach", sender, { kind: "text", body: "Nice loop" })).toEqual({
      type: "message",
      route: "rooms/r1",
      title: "Coach Linnea",
      body: "Nice loop",
      threadId: "room:r1",
      category: "GRADUS_MESSAGE",
    });
  });

  it("titles a parent or athlete by name and says a voice note is one", () => {
    const push = newMessagePush("r2", "parent", sender, { kind: "voice" });
    expect(push.title).toBe("Linnea Corwin");
    expect(push.body).toBe("Sent a voice note");
    expect(push.category).toBe("GRADUS_MESSAGE");
    expect(newMessagePush("r2", "athlete", undefined, { kind: "text", body: "Hi" }).title).toBe(
      "New message",
    );
  });
});

describe("replies and reactions", () => {
  const participants: RoomParticipant[] = [
    { userId: "coach-u", role: "coach", firstName: "Linnea", lastName: "C" },
    { userId: "ath-u", role: "athlete", firstName: "Maeve", lastName: "A" },
  ];
  const row = {
    id: "m0",
    room_id: "r1",
    direct_room_id: null,
    sender_user_id: "ath-u",
    sender_deleted_at: null,
    sender_role: "athlete",
    kind: "text",
    body: "Can we move\nThursday to 4?",
    audio_url: null,
    duration_seconds: null,
    created_at: "2026-10-14T10:00:00Z",
    plan_id: null,
  };

  it("quotes the sender's first name and a one-line excerpt", () => {
    expect(toReplyPreview(row, participants)).toEqual({
      id: "m0",
      senderRole: "athlete",
      senderFirstName: "Maeve",
      senderDeletedAt: null,
      kind: "text",
      excerpt: "Can we move Thursday to 4?",
    });
  });

  it("trims long quotes, and quotes voice notes and deleted senders without text", () => {
    const long = toReplyPreview({ ...row, body: "x".repeat(500) }, participants).excerpt;
    expect(long.length).toBe(REPLY_EXCERPT_MAX);
    expect(long.endsWith("…")).toBe(true);
    expect(toReplyPreview({ ...row, kind: "voice", body: "" }, participants).excerpt).toBe("");
    const gone = toReplyPreview({ ...row, sender_user_id: null }, participants);
    expect(gone.excerpt).toBe("");
    expect(gone.senderFirstName).toBe("");
    expect(gone.senderDeletedAt).toBe("2026-10-14T10:00:00Z");
  });

  it("defaults a message to no quote and no reactions", () => {
    const dto = toMessageDTO(row, "r1", participants, [], null, null);
    expect(dto.replyTo).toBeNull();
    expect(dto.reactions).toEqual([]);
    const withExtras = toMessageDTO(row, "r1", participants, [], null, null, {
      replyTo: toReplyPreview(row, participants),
      reactions: [{ userId: "coach-u", emoji: "👍" }],
    });
    expect(withExtras.replyTo?.id).toBe("m0");
    expect(withExtras.reactions).toEqual([{ userId: "coach-u", emoji: "👍" }]);
  });

  it("accepts only the five reactions, or null to clear", () => {
    for (const e of ["👍", "❤️", "😂", "🔥", "👏"]) expect(isReactionEmoji(e)).toBe(true);
    expect(isReactionEmoji("🙂")).toBe(false);
    expect(setReactionBody.safeParse({ emoji: null }).success).toBe(true);
    expect(setReactionBody.safeParse({ emoji: "🙂" }).success).toBe(false);
  });

  it("names the late column a missing-column error is about", () => {
    const err = (column: string) => ({
      code: "42703",
      message: `column messages.${column} does not exist`,
    });
    expect(missingLateColumn(err("reply_to_id"))).toBe("reply_to_id");
    expect(missingLateColumn(err("transcript"))).toBe("transcript");
    expect(missingLateColumn(err("transcript"), new Set(["transcript"]))).toBeNull();
    expect(missingLateColumn(err("body"))).toBeNull();
    expect(missingLateColumn({ code: "42501", message: "permission denied" })).toBeNull();
    expect(missingLateColumn(null)).toBeNull();
  });
});

describe("device transcripts on voice notes", () => {
  const voice = { kind: "voice" as const, audioPath: "r/u/a.m4a", mimeType: "audio/mp4", durationSeconds: 4 };

  it("accepts a transcript made on the sender's device, trimmed", () => {
    const parsed = sendMessageBody.parse({ ...voice, transcript: "  Bend the knee on the takeoff.  " });
    expect(parsed.kind === "voice" && parsed.transcript).toBe("Bend the knee on the takeoff.");
  });

  it("keeps the transcript optional and refuses a blank or oversized one", () => {
    expect(sendMessageBody.safeParse(voice).success).toBe(true);
    // null: the device tried and got no words; the note is still sent.
    expect(sendMessageBody.safeParse({ ...voice, transcript: null }).success).toBe(true);
    expect(sendMessageBody.safeParse({ ...voice, transcript: "   " }).success).toBe(false);
    expect(sendMessageBody.safeParse({ ...voice, transcript: "a".repeat(4001) }).success).toBe(false);
  });
});

describe("roomClosedMessage", () => {
  it("is null while the room is open", () => {
    expect(roomClosedMessage(null, "coach")).toBeNull();
  });

  it("tells the coach the rule and the athlete and parent what they can do (decision #56)", () => {
    expect(roomClosedMessage("guardian_required", "coach")).toBe(
      "This athlete's parent or guardian hasn't joined Gradus yet. Messages open once they have.",
    );
    expect(roomClosedMessage("guardian_required", "athlete")).toBe(
      "Messages with your coach open once your parent or guardian has joined Gradus.",
    );
    expect(roomClosedMessage("provisional", "athlete")).toBe(
      "Messages with your coach open once your parent or guardian has joined Gradus.",
    );
    expect(roomClosedMessage("guardian_required", "parent")).toBe(
      "Confirm you're an adult in Settings to open messaging with this coach.",
    );
  });

  it("falls back to the shared restriction text for pauses", () => {
    expect(roomClosedMessage("paused", "coach")).toBe("This athlete's account is paused.");
    expect(roomClosedMessage("paused_by_parent", "parent")).toBe(
      "The parent has paused messaging with this coach.",
    );
  });
});
