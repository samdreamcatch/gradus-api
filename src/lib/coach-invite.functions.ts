import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  getCoachInviteCode as getCoachInviteCodeShared,
  rotateCoachInviteCode as rotateCoachInviteCodeShared,
} from "./invites.server";

type Client = SupabaseClient<Database>;

/*
 * Thin wrappers over src/lib/invites.server.ts, shared with
 * `GET /api/v1/coach/invite-code` and `POST /api/v1/coach/invite-code/rotate`.
 */

export const getCoachInviteCode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    getCoachInviteCodeShared({ userId: context.userId, supabase: context.supabase as Client }),
  );

export const rotateCoachInviteCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    rotateCoachInviteCodeShared({ userId: context.userId, supabase: context.supabase as Client }),
  );
