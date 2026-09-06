import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { rethrowPlain } from "./api/errors";
import * as shared from "./moves.server";
import { addPlanMoveToLibraryInput, forkPlanMoveToLibraryInput, moveInput } from "./moves.server";

/*
 * Thin wrappers over src/lib/moves.server.ts, shared with the
 * `/api/v1/coach/moves` routes. Behavior and error messages are unchanged.
 */

export type { MoveDTO, NameConflict, TargetKind } from "./moves.server";

type Client = SupabaseClient<Database>;

const ctxOf = (context: { userId: string; supabase: unknown }): shared.MovesContext => ({
  userId: context.userId,
  supabase: context.supabase as Client,
});

export const listMoves = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return await shared.listMoves(ctxOf(context));
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const upsertMove = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => moveInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await shared.upsertMove(ctxOf(context), data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const archiveMove = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await shared.archiveMove(ctxOf(context), data.id);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/* ---------------- Save a plan-only move into the coach library ---------------- */

export const addPlanMoveToLibrary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => addPlanMoveToLibraryInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await shared.addPlanMoveToLibrary(ctxOf(context), data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/* ---------------- Update the linked library move from a plan move's fields ---------------- */

export const updateLibraryMoveFromPlanMove = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ planMoveId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await shared.updateLibraryMoveFromPlanMove(ctxOf(context), data.planMoveId);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/* ---------------- Fork edits into a new library move ---------------- */

export const forkPlanMoveToLibrary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => forkPlanMoveToLibraryInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await shared.forkPlanMoveToLibrary(ctxOf(context), data);
    } catch (err) {
      rethrowPlain(err);
    }
  });
