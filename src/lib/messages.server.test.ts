import { describe, expect, it, mock } from "bun:test";
import { ApiError } from "./api/errors";
import {
  decodeCursor,
  encodeCursor,
  getRoomDetail,
  getRoomPage,
  getUnreadTotal,
  idChunks,
  isMissingFunction,
  listRooms,
  markRoomRead,
  isReactionEmoji,
  missingLateColumn,
  newMessagePush,
  partitionByKind,
  roomClosedMessage,
  resetMarkRoomReadProbe,
  resetRoomSummariesProbe,
  roomsDigest,
  REPLY_EXCERPT_MAX,
  sendMessageBody,
  setReactionBody,
  summarizeRoomMessages,
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
  const voice = {
    kind: "voice" as const,
    audioPath: "r/u/a.m4a",
    mimeType: "audio/mp4",
    durationSeconds: 4,
  };

  it("accepts a transcript made on the sender's device, trimmed", () => {
    const parsed = sendMessageBody.parse({
      ...voice,
      transcript: "  Bend the knee on the takeoff.  ",
    });
    expect(parsed.kind === "voice" && parsed.transcript).toBe("Bend the knee on the takeoff.");
  });

  it("keeps the transcript optional and refuses a blank or oversized one", () => {
    expect(sendMessageBody.safeParse(voice).success).toBe(true);
    // null: the device tried and got no words; the note is still sent.
    expect(sendMessageBody.safeParse({ ...voice, transcript: null }).success).toBe(true);
    expect(sendMessageBody.safeParse({ ...voice, transcript: "   " }).success).toBe(false);
    expect(sendMessageBody.safeParse({ ...voice, transcript: "a".repeat(4001) }).success).toBe(
      false,
    );
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

/* -------------------------------------------------------------------------- */
/* The conversations list against a small in-memory Supabase-shaped fake.     */
/* -------------------------------------------------------------------------- */

type FakeRow = Record<string, any>;
type FakeError = { code?: string; message: string };

/**
 * `from(table)` with the filters the list uses, `maybeSingle`, and
 * `rpc("room_summaries")`. `errors` fails every read of a table (or the RPC,
 * under its name); `withFunction: false` answers the RPC the way the API does
 * before the migration is applied. `calls` lists each read in order.
 */
function fakeMessagesAdmin(
  tables: Record<string, FakeRow[]>,
  opts: {
    errors?: Record<string, FakeError>;
    withFunction?: boolean;
    /** Storage paths that can't be signed; "*" fails the whole storage call. */
    unsignable?: string[];
  } = {},
) {
  const calls: string[] = [];
  const errors = opts.errors ?? {};

  const from = (table: string) => {
    const filters: Array<(r: FakeRow) => boolean> = [];
    let order: { col: string; asc: boolean } | null = null;
    let limit: number | null = null;
    const rows = () => {
      let out = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (order) {
        const { col, asc } = order;
        out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0));
        if (!asc) out.reverse();
      }
      return limit === null ? out : out.slice(0, limit);
    };
    const result = () => {
      calls.push(table);
      return errors[table] ? { data: null, error: errors[table] } : { data: rows(), error: null };
    };
    const self: FakeRow = {
      select: () => self,
      eq: (col: string, value: unknown) => (filters.push((r) => r[col] === value), self),
      in: (col: string, values: unknown[]) => (filters.push((r) => values.includes(r[col])), self),
      neq: (col: string, value: unknown) => (filters.push((r) => r[col] !== value), self),
      lt: (col: string, value: any) => (filters.push((r) => r[col] < value), self),
      // Only `.not(col, "is", null)` is used.
      not: (col: string) => (filters.push((r) => r[col] !== null && r[col] !== undefined), self),
      upsert: (rows: FakeRow[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        calls.push(`upsert:${table}`);
        // Without these the real API would overwrite and return every row.
        if (options?.onConflict !== "message_id,user_id" || options?.ignoreDuplicates !== true) {
          throw new Error("fake upsert: expected onConflict message_id,user_id + ignoreDuplicates");
        }
        const list = (tables[table] ??= []);
        const added = rows.filter(
          (row) => !list.some((r) => r.message_id === row.message_id && r.user_id === row.user_id),
        );
        list.push(...added);
        const res = errors[table]
          ? { data: null, error: errors[table] }
          : { data: added, error: null };
        return { select: async () => res };
      },
      or: (expr: string) => {
        const clauses = expr.split(",").map((part) => {
          const [col, , ...rest] = part.split(".");
          return { col: col!, value: rest.join(".") };
        });
        filters.push((r) => clauses.some((c) => r[c.col] === c.value));
        return self;
      },
      order: (col: string, o?: { ascending?: boolean }) => {
        order = { col, asc: o?.ascending !== false };
        return self;
      },
      limit: (n: number) => ((limit = n), self),
      maybeSingle: async () => {
        const res = result();
        if (res.error) return res;
        if (res.data!.length > 1) {
          return { data: null, error: { code: "PGRST116", message: "multiple rows returned" } };
        }
        return { data: res.data![0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return self;
  };

  // What the SQL function returns: one row per room, last message plus unread count.
  const rpc = async (name: string, args: FakeRow) => {
    calls.push(`rpc:${name}`);
    if (errors[name]) return { data: null, error: errors[name] };
    if (opts.withFunction === false) {
      return {
        data: null,
        error: {
          code: "PGRST202",
          message: `Could not find the function public.${name} in the schema cache`,
        },
      };
    }
    if (name === "mark_room_read") {
      const column = args.p_direct ? "direct_room_id" : "room_id";
      const list = (tables.message_reads ??= []);
      const unread = (tables.messages ?? []).filter(
        (m) =>
          m[column] === args.p_room_id &&
          m.sender_user_id &&
          m.sender_user_id !== args.p_user_id &&
          !list.some((r) => r.message_id === m.id && r.user_id === args.p_user_id),
      );
      list.push(...unread.map((m) => ({ message_id: m.id, user_id: args.p_user_id })));
      return { data: unread.length, error: null };
    }
    const reads = new Set(
      (tables.message_reads ?? [])
        .filter((r) => r.user_id === args.p_user_id)
        .map((r) => r.message_id),
    );
    const summary = (key: string, column: "room_id" | "direct_room_id") => {
      const msgs = (tables.messages ?? [])
        .filter((m) => m[column] === key)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      const last = msgs[0];
      return {
        room_key: key,
        unread_count: msgs.filter(
          (m) => m.sender_user_id && m.sender_user_id !== args.p_user_id && !reads.has(m.id),
        ).length,
        id: last?.id ?? null,
        room_id: last?.room_id ?? null,
        direct_room_id: last?.direct_room_id ?? null,
        sender_user_id: last?.sender_user_id ?? null,
        sender_deleted_at: last?.sender_deleted_at ?? null,
        sender_role: last?.sender_role ?? null,
        kind: last?.kind ?? null,
        body: last?.body ?? null,
        created_at: last?.created_at ?? null,
      };
    };
    return {
      data: [
        ...(args.p_athlete_room_ids as string[]).map((id) => summary(id, "room_id")),
        ...(args.p_direct_room_ids as string[]).map((id) => summary(id, "direct_room_id")),
      ],
      error: null,
    };
  };

  const storage = {
    from: () => ({
      createSignedUrls: async (paths: string[]) => {
        calls.push(`storage:${paths.length}`);
        const bad = opts.unsignable ?? [];
        if (bad.includes("*")) return { data: null, error: { message: "storage is down" } };
        return {
          data: paths.map((path) =>
            bad.includes(path)
              ? { path, signedUrl: null, error: "The object does not exist" }
              : { path, signedUrl: `https://signed.example/${path}`, error: null },
          ),
          error: null,
        };
      },
    }),
  };

  return { from, rpc, storage, calls };
}

async function withMessagesAdmin<T>(
  admin: ReturnType<typeof fakeMessagesAdmin>,
  run: () => Promise<T>,
): Promise<T> {
  const real = await import("@/integrations/supabase/client.server");
  mock.module("@/integrations/supabase/client.server", () => ({ ...real, supabaseAdmin: admin }));
  resetRoomSummariesProbe();
  resetMarkRoomReadProbe();
  try {
    return await run();
  } finally {
    mock.module("@/integrations/supabase/client.server", () => real);
    resetRoomSummariesProbe();
    resetMarkRoomReadProbe();
  }
}

async function thrown(run: () => Promise<unknown>): Promise<Error | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Coach Linnea (the viewer) with two athlete rooms and one direct room:
 *   - Maeve's room: an old message Linnea read, Linnea's own reply, two
 *     unread from Maeve and her parent, and a newest message from an account
 *     since deleted (never unread, but it is the preview);
 *   - Theo's room: one message, read;
 *   - the direct room with parent Corin: one unread;
 *   - a second direct room with no messages.
 */
function coachInbox(): Record<string, FakeRow[]> {
  const msg = (
    id: string,
    room: { room_id?: string; direct_room_id?: string },
    sender: string | null,
    role: string,
    minute: number,
    over: FakeRow = {},
  ): FakeRow => ({
    id,
    room_id: room.room_id ?? null,
    direct_room_id: room.direct_room_id ?? null,
    sender_user_id: sender,
    sender_deleted_at: null,
    sender_role: role,
    kind: "text",
    body: `body ${id}`,
    created_at: `2026-11-01T10:${String(minute).padStart(2, "0")}:00+00:00`,
    ...over,
  });
  return {
    coach_profiles: [
      { id: "coach-1", user_id: "u-linnea", first_name: "Linnea", last_name: "Corwin" },
    ],
    athletes: [
      {
        id: "ath-maeve",
        user_id: "u-maeve",
        parent_id: "par-corin",
        first_name: "Maeve",
        last_name: "Abbott",
      },
      {
        id: "ath-theo",
        user_id: "u-theo",
        parent_id: null,
        first_name: "Theo",
        last_name: "Marsh",
      },
    ],
    parent_profiles: [
      { id: "par-corin", user_id: "u-corin", first_name: "Corin", last_name: "Abbott" },
      { id: "par-tobias", user_id: "u-tobias", first_name: "Tobias", last_name: "Fairbank" },
    ],
    message_rooms: [
      {
        id: "room-maeve",
        coach_id: "coach-1",
        athlete_id: "ath-maeve",
        updated_at: "2026-10-01T00:00:00+00:00",
      },
      {
        id: "room-theo",
        coach_id: "coach-1",
        athlete_id: "ath-theo",
        updated_at: "2026-10-02T00:00:00+00:00",
      },
    ],
    direct_rooms: [
      {
        id: "direct-corin",
        kind: "coach_parent",
        user_a: "u-linnea",
        user_b: "u-corin",
        coach_a_id: null,
        coach_b_id: null,
        coach_id: "coach-1",
        parent_id: "par-corin",
        updated_at: "2026-10-03T00:00:00+00:00",
      },
      {
        id: "direct-tobias",
        kind: "coach_parent",
        user_a: "u-tobias",
        user_b: "u-linnea",
        coach_a_id: null,
        coach_b_id: null,
        coach_id: "coach-1",
        parent_id: "par-tobias",
        updated_at: "2026-10-04T00:00:00+00:00",
      },
    ],
    messages: [
      msg("m1", { room_id: "room-maeve" }, "u-maeve", "athlete", 1),
      msg("m2", { room_id: "room-maeve" }, "u-linnea", "coach", 2),
      msg("m3", { room_id: "room-maeve" }, "u-maeve", "athlete", 3),
      msg("m4", { room_id: "room-maeve" }, "u-corin", "parent", 4),
      msg("m5", { room_id: "room-maeve" }, null, "athlete", 5, {
        sender_deleted_at: "2026-11-02T00:00:00+00:00",
      }),
      msg("t1", { room_id: "room-theo" }, "u-theo", "athlete", 6, { kind: "voice", body: "" }),
      msg("d1", { direct_room_id: "direct-corin" }, "u-corin", "parent", 7),
    ],
    message_reads: [
      { message_id: "m1", user_id: "u-linnea", read_at: "2026-11-01T10:01:30+00:00" },
      { message_id: "t1", user_id: "u-linnea", read_at: "2026-11-01T10:06:30+00:00" },
      // Someone else's receipt never marks it read for Linnea.
      { message_id: "m3", user_id: "u-corin", read_at: "2026-11-01T10:03:30+00:00" },
    ],
    user_blocks: [],
  };
}

const viewer = { userId: "u-linnea" };

describe("listRooms and getUnreadTotal", () => {
  it("returns an empty list only for an account that really has no conversations", async () => {
    const admin = fakeMessagesAdmin({});
    await withMessagesAdmin(admin, async () => {
      expect(await listRooms({ userId: "u-nobody" }, undefined)).toEqual({ rooms: [] });
      expect(await getUnreadTotal({ userId: "u-nobody" }, undefined)).toEqual({ total: 0 });
    });
  });

  it("throws, never an empty list, when any lookup behind the list fails", async () => {
    const down = { code: "57014", message: "canceling statement due to statement timeout" };
    for (const failing of [
      "coach_profiles", // identity
      "message_rooms", // rooms
      "direct_rooms",
      "athletes", // participants (and identity)
      "room_summaries", // last message + unread
    ]) {
      const admin = fakeMessagesAdmin(coachInbox(), { errors: { [failing]: down } });
      await withMessagesAdmin(admin, async () => {
        const listErr = await thrown(() => listRooms(viewer, undefined));
        expect(listErr?.message).toBe("Couldn't load conversations");
        const totalErr = await thrown(() => getUnreadTotal(viewer, undefined));
        if (failing !== "athletes") expect(totalErr?.message).toBe("Couldn't load conversations");
      });
    }
  });

  it("throws on the fallback path too when the message or receipt read fails", async () => {
    const down = { code: "57014", message: "canceling statement due to statement timeout" };
    for (const failing of ["messages", "message_reads"]) {
      const admin = fakeMessagesAdmin(coachInbox(), {
        errors: { [failing]: down },
        withFunction: false,
      });
      await withMessagesAdmin(admin, async () => {
        expect((await thrown(() => listRooms(viewer, undefined)))?.message).toBe(
          "Couldn't load conversations",
        );
      });
    }
  });

  it("still treats two profile rows for one user as no profile, not a failure", async () => {
    const seed = coachInbox();
    seed.parent_profiles!.push(
      { id: "p-x", user_id: "u-linnea" },
      { id: "p-y", user_id: "u-linnea" },
    );
    await withMessagesAdmin(fakeMessagesAdmin(seed), async () => {
      expect((await listRooms(viewer, undefined)).rooms.length).toBe(4);
    });
  });

  const expectInbox = (rooms: RoomSummary[]) => {
    // Most recent activity first; the empty room sorts by its own updated_at.
    expect(rooms.map((r) => r.id)).toEqual([
      "direct-corin",
      "room-theo",
      "room-maeve",
      "direct-tobias",
    ]);
    const byId = new Map(rooms.map((r) => [r.id, r]));

    const maeve = byId.get("room-maeve")!;
    // m3 and m4; not m1 (read), m2 (her own), or m5 (deleted sender).
    expect(maeve.unreadCount).toBe(2);
    expect(maeve.lastMessage).toEqual({
      id: "m5",
      kind: "text",
      body: "body m5",
      senderRole: "athlete",
      senderFirstName: "",
      senderDeletedAt: "2026-11-02T00:00:00+00:00",
      createdAt: "2026-11-01T10:05:00+00:00",
    });
    expect(maeve.updatedAt).toBe("2026-11-01T10:05:00+00:00");
    expect(maeve.myRole).toBe("coach");
    expect(maeve.participants.map((p) => `${p.role}:${p.firstName}`)).toEqual([
      "coach:Linnea",
      "athlete:Maeve",
      "parent:Corin",
    ]);

    const theo = byId.get("room-theo")!;
    expect(theo.unreadCount).toBe(0);
    expect(theo.lastMessage?.kind).toBe("voice");
    expect(theo.lastMessage?.senderFirstName).toBe("Theo");

    const corin = byId.get("direct-corin")!;
    expect(corin.kind).toBe("coach_parent");
    expect(corin.unreadCount).toBe(1);
    expect(corin.lastMessage?.id).toBe("d1");
    expect(corin.participants.map((p) => p.firstName)).toEqual(["Linnea", "Corin"]);

    const tobias = byId.get("direct-tobias")!;
    expect(tobias.lastMessage).toBeNull();
    expect(tobias.unreadCount).toBe(0);
    expect(tobias.updatedAt).toBe("2026-10-04T00:00:00+00:00");
  };

  it("takes last message and unread counts from the database function, without reading message history", async () => {
    const admin = fakeMessagesAdmin(coachInbox());
    await withMessagesAdmin(admin, async () => {
      const { rooms } = await listRooms(viewer, undefined);
      expectInbox(rooms);
      expect(admin.calls).toContain("rpc:room_summaries");
      expect(admin.calls).not.toContain("messages");
      expect(admin.calls).not.toContain("message_reads");

      const { total } = await getUnreadTotal(viewer, undefined);
      expect(total).toBe(3);
      expect(total).toBe(rooms.reduce((sum, r) => sum + r.unreadCount, 0));
    });
  });

  it("falls back to the old logic, with the same answer, while the function is missing", async () => {
    const admin = fakeMessagesAdmin(coachInbox(), { withFunction: false });
    await withMessagesAdmin(admin, async () => {
      const { rooms } = await listRooms(viewer, undefined);
      expectInbox(rooms);
      expect(admin.calls).toContain("messages");
      expect(admin.calls).toContain("message_reads");

      // The function is not asked for again straight away.
      const before = admin.calls.filter((c) => c === "rpc:room_summaries").length;
      expect(before).toBe(1);
      expect(await getUnreadTotal(viewer, undefined)).toEqual({ total: 3 });
      expect(admin.calls.filter((c) => c === "rpc:room_summaries").length).toBe(1);
    });
  });

  it("hides an empty room with a blocked person but keeps one that has history", async () => {
    const seed = coachInbox();
    seed.user_blocks = [
      { blocker_user_id: "u-linnea", blocked_user_id: "u-tobias" },
      { blocker_user_id: "u-corin", blocked_user_id: "u-linnea" },
    ];
    await withMessagesAdmin(fakeMessagesAdmin(seed), async () => {
      const ids = (await listRooms(viewer, undefined)).rooms.map((r) => r.id);
      expect(ids).toEqual(["direct-corin", "room-theo", "room-maeve"]);
    });
  });

  it("throws for a parent when the lookup of their athletes fails", async () => {
    const down = { code: "57014", message: "canceling statement due to statement timeout" };
    const seed = coachInbox();
    seed.athlete_guardians = [];
    const admin = fakeMessagesAdmin(seed, { errors: { athlete_guardians: down } });
    await withMessagesAdmin(admin, async () => {
      expect((await thrown(() => listRooms({ userId: "u-corin" }, undefined)))?.message).toBe(
        "Couldn't load conversations",
      );
    });
  });

  it("shows a parent the rooms of the athletes they can see", async () => {
    const seed = coachInbox();
    seed.athlete_guardians = [];
    await withMessagesAdmin(fakeMessagesAdmin(seed), async () => {
      const { rooms } = await listRooms({ userId: "u-corin" }, undefined);
      expect(rooms.map((r) => `${r.id}:${r.myRole}:${r.unreadCount}`)).toEqual([
        "direct-corin:parent:0",
        "room-maeve:parent:2", // m1 and m2; m3 he read, m4 is his own, m5 has no sender
      ]);
    });
  });
});

/** `coachInbox()` with adult athletes (so the room rule leaves the composer open) and a voice note with a file. */
function threadInbox(): Record<string, FakeRow[]> {
  const seed = coachInbox();
  for (const a of seed.athletes!)
    Object.assign(a, { birthdate: "1990-01-01", account_state: "active" });
  seed.coach_athletes = [];
  seed.message_reactions = [];
  seed.plans = [{ id: "plan-1", title: "Loop week", coach_id: "coach-1" }];
  for (const m of seed.messages!)
    Object.assign(m, {
      audio_url: null,
      duration_seconds: null,
      plan_id: null,
      reply_to_id: null,
      transcript: null,
    });
  Object.assign(seed.messages!.find((m) => m.id === "m3")!, { plan_id: "plan-1" });
  Object.assign(seed.messages!.find((m) => m.id === "m4")!, { reply_to_id: "m1" });
  Object.assign(seed.messages!.find((m) => m.id === "t1")!, {
    audio_url: "room-theo/t1.m4a",
    duration_seconds: 12,
  });
  return seed;
}

describe("opening a thread", () => {
  it("returns a page oldest-first with reads, plan tags, quotes and the header", async () => {
    const admin = fakeMessagesAdmin(threadInbox());
    await withMessagesAdmin(admin, async () => {
      const page = await getRoomPage(viewer, { roomId: "room-maeve", limit: 3 });
      expect(page.items.map((m) => m.id)).toEqual(["m3", "m4", "m5"]);
      expect(page.nextCursor).not.toBeNull();
      expect(page.items[0]!.plan).toEqual({ id: "plan-1", title: "Loop week", coachId: "coach-1" });
      expect(page.items[0]!.readBy).toEqual([
        { userId: "u-corin", readAt: "2026-11-01T10:03:30+00:00" },
      ]);
      expect(page.items[1]!.replyTo?.id).toBe("m1");
      expect(page.items[1]!.senderFirstName).toBe("Corin");
      expect(page.items[2]!.senderUserId).toBeNull();
      expect(page.room).toEqual({
        id: "room-maeve",
        kind: "athlete",
        coachId: "coach-1",
        athleteId: "ath-maeve",
        participants: page.room.participants,
        myRole: "coach",
        myUserId: "u-linnea",
        myCoachId: "coach-1",
        messagingPausedByParent: false,
        messagingClosedMessage: null,
        viewerTextOnly: false,
      });
      expect(page.room.participants.map((p) => p.firstName)).toEqual(["Linnea", "Maeve", "Corin"]);

      const older = await getRoomPage(viewer, {
        roomId: "room-maeve",
        limit: 3,
        cursor: page.nextCursor!,
      });
      expect(older.items.map((m) => m.id)).toEqual(["m1", "m2"]);
      expect(older.nextCursor).toBeNull();
    });
  });

  it("signs a page's voice notes in one storage call, and none when there are none", async () => {
    const admin = fakeMessagesAdmin(threadInbox());
    await withMessagesAdmin(admin, async () => {
      const theo = await getRoomPage(viewer, { roomId: "room-theo", limit: 50 });
      expect(theo.items[0]!.audioUrl).toBe("https://signed.example/room-theo/t1.m4a");
      expect(admin.calls.filter((c) => c.startsWith("storage:"))).toEqual(["storage:1"]);
      await getRoomPage(viewer, { roomId: "room-maeve", limit: 50 });
      expect(admin.calls.filter((c) => c.startsWith("storage:")).length).toBe(1);
    });
  });

  it("still opens the thread, without audio, when a note or the whole storage call can't be signed", async () => {
    for (const unsignable of [["room-theo/t1.m4a"], ["*"]]) {
      const admin = fakeMessagesAdmin(threadInbox(), { unsignable });
      await withMessagesAdmin(admin, async () => {
        const theo = await getRoomPage(viewer, { roomId: "room-theo", limit: 50 });
        expect(theo.items.map((m) => m.id)).toEqual(["t1"]);
        expect(theo.items[0]!.audioUrl).toBeNull();
      });
    }
  });

  it("does not read the coach's profile a second time for the header", async () => {
    const admin = fakeMessagesAdmin(threadInbox());
    await withMessagesAdmin(admin, async () => {
      await getRoomPage(viewer, { roomId: "room-theo", limit: 50 });
      // Once for the identity, once for the room's participants.
      expect(admin.calls.filter((c) => c === "coach_profiles").length).toBe(2);
    });
  });

  it("gives the web's whole-thread read the same messages", async () => {
    const admin = fakeMessagesAdmin(threadInbox());
    await withMessagesAdmin(admin, async () => {
      const detail = await getRoomDetail(viewer, { roomId: "room-maeve" });
      expect(detail.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
      expect(detail.room.myCoachId).toBe("coach-1");
    });
  });

  it("is not found for a room the caller is not in, and a parent's header has no coach id", async () => {
    const seed = threadInbox();
    seed.athlete_guardians = [];
    await withMessagesAdmin(fakeMessagesAdmin(seed), async () => {
      const err = await thrown(() =>
        getRoomPage({ userId: "u-theo" }, { roomId: "room-maeve", limit: 50 }),
      );
      expect(err?.message).toBe("Conversation not found");
      const asParent = await getRoomPage(
        { userId: "u-corin" },
        { roomId: "room-maeve", limit: 50 },
      );
      expect(asParent.room.myRole).toBe("parent");
      expect(asParent.room.myCoachId).toBeNull();
    });
  });
});

describe("markRoomRead", () => {
  it("marks other people's unread messages in the database function, reading no history", async () => {
    const admin = fakeMessagesAdmin(threadInbox());
    await withMessagesAdmin(admin, async () => {
      expect(await markRoomRead(viewer, { roomId: "room-maeve" })).toEqual({ marked: 2 });
      expect(admin.calls).toContain("rpc:mark_room_read");
      expect(admin.calls).not.toContain("messages");
      expect(await markRoomRead(viewer, { roomId: "room-maeve" })).toEqual({ marked: 0 });
      expect(await markRoomRead(viewer, { roomId: "direct-corin" })).toEqual({ marked: 1 });
      expect((await listRooms(viewer, undefined)).rooms.every((r) => r.unreadCount === 0)).toBe(
        true,
      );
    });
  });

  it("falls back while the function is missing, with the same result", async () => {
    const admin = fakeMessagesAdmin(threadInbox(), { withFunction: false });
    await withMessagesAdmin(admin, async () => {
      expect(await markRoomRead(viewer, { roomId: "room-maeve" })).toEqual({ marked: 2 });
      expect(admin.calls).toContain("upsert:message_reads");
      expect(await markRoomRead(viewer, { roomId: "room-maeve" })).toEqual({ marked: 0 });
      expect(admin.calls.filter((c) => c === "rpc:mark_room_read").length).toBe(1);
      expect(await getUnreadTotal(viewer, undefined)).toEqual({ total: 1 });
    });
  });

  it("marks nothing for a room the caller is not in, and throws when the database fails", async () => {
    await withMessagesAdmin(fakeMessagesAdmin(threadInbox()), async () => {
      expect(await markRoomRead({ userId: "u-theo" }, { roomId: "room-maeve" })).toEqual({
        marked: 0,
      });
    });
    const down = { code: "57014", message: "canceling statement due to statement timeout" };
    const admin = fakeMessagesAdmin(threadInbox(), { errors: { mark_room_read: down } });
    await withMessagesAdmin(admin, async () => {
      expect((await thrown(() => markRoomRead(viewer, { roomId: "room-maeve" })))?.message).toBe(
        "Couldn't update read status",
      );
    });
  });
});

describe("long id lists", () => {
  it("are read in slices so the request URL stays short", async () => {
    expect(idChunks([])).toEqual([]);
    expect(idChunks(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);

    // 250 athlete rooms for one coach: every name still resolves.
    const seed = coachInbox();
    for (let i = 0; i < 250; i += 1) {
      seed.athletes!.push({
        id: `ath-${i}`,
        user_id: `u-ath-${i}`,
        parent_id: null,
        first_name: `A${i}`,
        last_name: "X",
      });
      seed.message_rooms!.push({
        id: `room-${i}`,
        coach_id: "coach-1",
        athlete_id: `ath-${i}`,
        updated_at: "2026-09-01T00:00:00+00:00",
      });
    }
    for (const withFunction of [true, false]) {
      const admin = fakeMessagesAdmin(seed, { withFunction });
      await withMessagesAdmin(admin, async () => {
        const { rooms } = await listRooms(viewer, undefined);
        expect(rooms.length).toBe(254);
        expect(rooms.every((r) => r.kind !== "athlete" || r.participants.length >= 2)).toBe(true);
        expect(admin.calls.filter((c) => c === "athletes").length).toBe(4); // identity + 3 slices
        expect(rooms.find((r) => r.id === "room-maeve")?.unreadCount).toBe(2);
      });
    }
  });
});

describe("summarizeRoomMessages and isMissingFunction", () => {
  it("counts only other people's unread messages and keeps the newest as last", () => {
    const row = (id: string, sender: string | null, at: string) => ({
      id,
      room_id: "r1",
      direct_room_id: null,
      sender_user_id: sender,
      sender_deleted_at: null,
      sender_role: "coach",
      kind: "text",
      body: "",
      created_at: at,
    });
    const out = summarizeRoomMessages(
      [row("a", "them", "2026-01-01"), row("c", null, "2026-01-03"), row("b", "me", "2026-01-02")],
      new Set<string>(),
      "me",
    );
    expect(out.get("r1")?.unread).toBe(1);
    expect(out.get("r1")?.last?.id).toBe("c");
    expect(
      summarizeRoomMessages([row("a", "them", "2026-01-01")], new Set(["a"]), "me").get("r1")
        ?.unread,
    ).toBe(0);
  });

  it("recognizes a missing function and nothing else", () => {
    expect(isMissingFunction({ code: "PGRST202", message: "" })).toBe(true);
    expect(isMissingFunction({ code: "42883", message: "" })).toBe(true);
    expect(
      isMissingFunction({
        message: "function public.room_summaries(uuid, uuid[], uuid[]) does not exist",
      }),
    ).toBe(true);
    expect(isMissingFunction({ code: "57014", message: "statement timeout" })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });
});
