import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { rethrowPlain } from "./api/errors";
import {
  createCoachResource as createCoachResourceImpl,
  createCoachResourceInput,
  createCoachResourceUploadUrl as createCoachResourceUploadUrlImpl,
  createCoachResourceUploadUrlInput,
  deleteCoachResource as deleteCoachResourceImpl,
  listCoachResources as listCoachResourcesImpl,
} from "./coach-resources.server";

// Re-export types so existing web imports keep working.
export type {
  CoachResourceKind,
  CoachResourceDTO,
  LibraryResourceDTO,
  CoachResourcesDTO,
} from "./coach-resources.server";

type Client = SupabaseClient<Database>;

/*
 * Thin wrappers over the shared entry points in
 * src/lib/coach-resources.server.ts, shared with the `/api/v1/coach/resources*`
 * routes. Behavior and error messages are unchanged.
 */

export const listCoachResources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return await listCoachResourcesImpl({
        userId: context.userId,
        supabase: context.supabase as Client,
      });
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const createCoachResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createCoachResourceInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await createCoachResourceImpl(
        { userId: context.userId, supabase: context.supabase as Client },
        data,
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const deleteCoachResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await deleteCoachResourceImpl(
        { userId: context.userId, supabase: context.supabase as Client },
        data.id,
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const createCoachResourceUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createCoachResourceUploadUrlInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await createCoachResourceUploadUrlImpl(
        { userId: context.userId, supabase: context.supabase as Client },
        data,
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });
