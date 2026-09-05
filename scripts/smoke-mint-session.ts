/**
 * Local-only smoke test for the session-minting path used by /auth/apple and
 * /auth/google (generateLink → /verify). The routes themselves need a real
 * Apple or Google identity token; this exercises the minting step directly.
 *
 * Run from the repo root with production Supabase credentials in the
 * environment (never commit them):
 *
 *   SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     bun scripts/smoke-mint-session.ts alyson.stemas@gmail.com
 *
 * Prints only the verified subject id, a masked email, and the expiry.
 * Tokens are never printed.
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../src/integrations/supabase/client.server";
import { mintSessionForEmail } from "../src/lib/api/auth-broker";

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    console.error("usage: bun scripts/smoke-mint-session.ts <email>");
    process.exit(2);
  }
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY must be set",
    );
    process.exit(2);
  }

  const session = await mintSessionForEmail(supabaseAdmin, email);
  const verifier = createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${session.accessToken}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await verifier.auth.getClaims(session.accessToken);
  if (error || !data?.claims?.sub) {
    console.error("FAIL: minted token did not verify", error?.message ?? "no claims");
    process.exit(1);
  }
  const masked = email.replace(/^(.).*(@.*)$/, "$1***$2");
  console.log(
    `PASS: minted a session for ${masked}; sub=${data.claims.sub}; expiresIn=${session.expiresIn}s; refreshToken=${session.refreshToken ? "present" : "MISSING"}`,
  );
}

void main();
