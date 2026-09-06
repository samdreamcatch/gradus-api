import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPreLessonBriefing as getPreLessonBriefingShared } from "./pre-lesson-briefing.server";

export type { PreLessonBriefing } from "./pre-lesson-briefing.server";

type Input = {
  athleteId: string;
  lessonDate: string; // YYYY-MM-DD
  refresh?: boolean;
};

/*
 * Thin wrapper over src/lib/pre-lesson-briefing.server.ts, shared with
 * `GET /api/v1/coach/athletes/{id}/briefing`. Behavior is unchanged.
 */
export const getPreLessonBriefing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: Input) => {
    if (!data?.athleteId || !data?.lessonDate) {
      throw new Error("athleteId and lessonDate are required");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.lessonDate)) {
      throw new Error("lessonDate must be YYYY-MM-DD");
    }
    return { athleteId: data.athleteId, lessonDate: data.lessonDate, refresh: !!data.refresh };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return getPreLessonBriefingShared(
      { userId: context.userId, admin: supabaseAdmin },
      data.athleteId,
      { lessonDate: data.lessonDate, refresh: data.refresh },
    );
  });
