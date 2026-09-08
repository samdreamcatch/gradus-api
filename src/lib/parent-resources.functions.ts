import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { rethrowPlain } from "./api/errors";
import {
  getParentResources as getParentResourcesImpl,
  getResourceSignedUrl as getResourceSignedUrlImpl,
} from "./parent-resources.server";

// Re-export types so existing web imports keep working.
export type {
  ResourceKind,
  ResourceSource,
  ResourceDTO,
  ParentResourcesDTO,
} from "./parent-resources.server";

type Client = SupabaseClient<Database>;

/*
 * Thin wrappers over the shared entry points in
 * src/lib/parent-resources.server.ts, shared with the `/api/v1/resources*`
 * routes. Behavior and error messages are unchanged.
 */

export const getParentResources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return await getParentResourcesImpl({
        userId: context.userId,
        supabase: context.supabase as Client,
      });
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const getResourceSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ resourceId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await getResourceSignedUrlImpl(
        { userId: context.userId, supabase: context.supabase as Client },
        data.resourceId,
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });
