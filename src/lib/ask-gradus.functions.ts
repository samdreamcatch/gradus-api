import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rethrowPlain } from "./api/errors";
import { askGradus as askGradusImpl, askGradusInput } from "./ask-gradus.server";

/*
 * Thin wrapper over the shared `askGradus` in src/lib/ask-gradus.server.ts,
 * shared with `POST /api/v1/ask`. Behavior and error messages are unchanged.
 */
export const askGradus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => askGradusInput.parse(data))
  .handler(async ({ data }): Promise<{ answer: string }> => {
    try {
      return await askGradusImpl(data);
    } catch (err) {
      rethrowPlain(err);
    }
  });
