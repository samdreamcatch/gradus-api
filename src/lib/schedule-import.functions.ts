import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rethrowPlain } from "./api/errors";
import {
  commitScheduleImport as commitScheduleImportImpl,
  commitScheduleImportInput,
  imageBytesFromDataUrl,
  parseScheduleImageBytes,
  type ParsedLesson,
} from "./schedule-import.server";

// Re-export so existing web imports keep working.
export type { ImportOutcome, ParsedLesson } from "./schedule-import.server";

/**
 * Coach schedule import: photo → rows, and reviewed rows → roster.
 *
 * Thin wrappers over the shared entry points in
 * src/lib/schedule-import.server.ts, shared with the
 * `/api/v1/coach/schedule-import/*` routes (PRD §3.6, Appendix A). Names,
 * methods, input schemas, return shapes and error messages are unchanged:
 * the photo parse still answers the raw `{ lessons }` the review step feeds
 * to `rowsFromParsedLessons`, and it stays auth-only (the API adds a coach
 * check on its side).
 */
async function getAdmin() {
  const m = await import("@/integrations/supabase/client.server");
  return m.supabaseAdmin;
}

export const parseScheduleImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        imageDataUrl: z
          .string()
          .min(32)
          .max(8_000_000)
          .refine((v) => v.startsWith("data:image/"), "Upload an image file"),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ lessons: ParsedLesson[] }> => {
    try {
      return await parseScheduleImageBytes(imageBytesFromDataUrl(data.imageDataUrl));
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const commitScheduleImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => commitScheduleImportInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await commitScheduleImportImpl(
        { admin: await getAdmin(), userId: context.userId },
        data,
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });
