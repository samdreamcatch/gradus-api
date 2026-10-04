import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import {
  decodeCursor,
  encodeCursor,
  partitionByKind,
  roomsDigest,
  toMessageDTO,
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
