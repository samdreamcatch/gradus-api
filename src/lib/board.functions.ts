import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BoardResponse } from "./board-types";
import {
  type BoardListEntry,
  fetchBoard,
  fetchBoardList,
  fetchMySkaterNames,
  searchBoards as searchBoardsServer,
} from "./board.server";

const slugSchema = z.object({ slug: z.string().trim().min(1).max(80) });

/** Public: the current board for one competition. Thin wrapper over fetchBoard. */
export const getBoard = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => slugSchema.parse(input))
  .handler(async ({ data }): Promise<BoardResponse | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return fetchBoard(supabaseAdmin as unknown as { from: (t: string) => any }, data.slug);
  });

/** Public: competitions with a board, newest first. Thin wrapper over fetchBoardList. */
export const listBoards = createServerFn({ method: "GET" }).handler(
  async (): Promise<BoardListEntry[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return fetchBoardList(supabaseAdmin as unknown as { from: (t: string) => any });
  },
);

/**
 * Public: search every IJS competition the catalog has found, or look up a
 * pasted IJS link or number. Thin wrapper over searchBoards.
 */
export const searchBoards = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ q: z.string().trim().min(2).max(120) }).parse(input),
  )
  .handler(async ({ data }): Promise<BoardListEntry[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Same limit as GET /api/v1/public/boards/search: a pasted number or link
    // makes the server fetch from IJS, so this public function must not be a
    // way around the API route's limiter.
    const { checkRateLimit } = await import("./api/rate-limit");
    const limited = await checkRateLimit(
      supabaseAdmin as never,
      { windowSeconds: 60, max: 30 },
      { route: "web:boards/search", ip: callerIp(), userId: null },
    );
    if (!limited.allowed) throw new Error("Too many searches. Try again in a minute.");
    return searchBoardsServer(supabaseAdmin as unknown as { from: (t: string) => any }, data.q);
  });

function callerIp(): string | null {
  try {
    return getRequestHeader("cf-connecting-ip") ?? getRequestIP({ xForwardedFor: true }) ?? null;
  } catch {
    return null;
  }
}

/** Signed-in extra: names of the viewer's athletes. Thin wrapper over fetchMySkaterNames. */
export const getMySkaterNames = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<string[]> => {
    return fetchMySkaterNames(context.supabase);
  });

const followSchema = z.object({
  slug: z.string().trim().min(1).max(80),
  skaterName: z.string().trim().min(1).max(120),
  deviceId: z.string().trim().min(8).max(64),
  following: z.boolean(),
});

/**
 * Public: records that a viewer (signed in or not) followed/unfollowed a
 * skater on a board. Anonymous viewers are identified only by a random
 * per-browser device id, so "how many people followed this skater" is
 * answerable without an account.
 */
export const setBoardFollow = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => followSchema.parse(input))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const table = (supabaseAdmin as unknown as { from: (t: string) => any }).from("board_follows");
    if (data.following) {
      // The anonymous uniqueness index is partial (device_id present, no
      // user_id), which PostgREST cannot target with ON CONFLICT — so check
      // first and insert only when the row is missing.
      const existing = await table
        .select("id")
        .is("user_id", null)
        .eq("device_id", data.deviceId)
        .eq("competition_slug", data.slug)
        .eq("skater_name", data.skaterName)
        .maybeSingle();
      if (!existing.data) {
        const { error } = await table.insert({
          user_id: null,
          device_id: data.deviceId,
          competition_slug: data.slug,
          skater_name: data.skaterName,
          source: "web",
        });
        // A duplicate from a racing tap is fine; anything else must be visible.
        if (error && error.code !== "23505") {
          console.error("[board] follow insert failed", error);
          throw new Error("Could not record the follow.");
        }
      }
    } else {
      await table
        .delete()
        .is("user_id", null)
        .eq("device_id", data.deviceId)
        .eq("competition_slug", data.slug)
        .eq("skater_name", data.skaterName);
    }
    return { ok: true };
  });
