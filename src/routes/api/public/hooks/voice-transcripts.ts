// Voice-note transcripts — called by pg_cron every 5 minutes.
//
// Transcribes a few voice notes that still have no transcript (send-time
// attempts that failed, and every note recorded before transcripts existed),
// newest first, after replying 202. Same auth as the other hooks: the
// Supabase publishable key.

import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { inBackground } from "@/lib/background";
import { sweepVoiceTranscripts } from "@/lib/voice-transcripts.server";

export const Route = createFileRoute("/api/public/hooks/voice-transcripts")({
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

        // Transcribing a batch takes longer than pg_net waits for a response,
        // so answer now and do the work in the request's post-response budget
        // (the claim inside transcribeVoiceNote keeps overlapping ticks apart).
        await inBackground("voice-transcripts:sweep", async () => {
          const result = await sweepVoiceTranscripts({ admin });
          console.log("[api] voice-transcripts", JSON.stringify(result));
        });
        return Response.json({ ok: true, accepted: true }, { status: 202 });
      },
    },
  },
});
