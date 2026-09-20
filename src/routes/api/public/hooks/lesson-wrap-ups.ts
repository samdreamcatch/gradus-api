// Lesson wrap-up prompts — called by pg_cron every 5 minutes.
//
// Finds lesson-slot occurrences that ended in the last few minutes (in
// America/New_York, like lesson reminders), skips any already wrapped up,
// records them in `lesson_wrap_up_prompts_sent`, and pushes the coach.
// Same auth as the other hooks: the Supabase publishable key in `apikey`.

import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { computeLessonWrapUpPrompts } from "@/lib/lesson-wrap-up-prompts.server";

export const Route = createFileRoute("/api/public/hooks/lesson-wrap-ups")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL;
        const publishable =
          process.env.SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceKey || !publishable) {
          return Response.json({ error: "server misconfigured" }, { status: 500 });
        }

        const apikey =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (apikey !== publishable) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        try {
          const result = await computeLessonWrapUpPrompts({ admin });
          return Response.json({ ok: true, ...result });
        } catch (error) {
          console.error("[api] lesson-wrap-ups failed", error);
          const message = error instanceof Error ? error.message : "unknown error";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
