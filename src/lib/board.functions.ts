import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BoardResponse } from "./board-types";
import {
  type BoardListEntry,
  fetchBoard,
  fetchBoardList,
  fetchMySkaterNames,
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

/** Signed-in extra: names of the viewer's athletes. Thin wrapper over fetchMySkaterNames. */
export const getMySkaterNames = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<string[]> => {
    return fetchMySkaterNames(context.supabase);
  });
