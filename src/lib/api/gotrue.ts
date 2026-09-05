/**
 * Thin GoTrue (Supabase Auth) REST client for the handful of calls that
 * need to run with service-role credentials to bypass Turnstile captcha —
 * the password grant, recovery email, and magic-link verification — per
 * docs/ios/PRD.md §6.4 and §4.2 ("Supabase Auth captcha... skips captcha
 * when the request carries service-role credentials").
 *
 * `supabase-js` doesn't expose these as service-role-authenticated calls
 * (the browser client is always anon/user-scoped), so this goes straight
 * to the REST API the same way GoTrue's own SDK does internally.
 */
export interface GoTrueSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface GoTrueErrorBody {
  error?: string;
  error_description?: string;
  msg?: string;
  error_code?: string;
}

export class GoTrueRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, body: GoTrueErrorBody | null) {
    super(body?.error_description ?? body?.msg ?? body?.error ?? "Auth request failed.");
    this.name = "GoTrueRequestError";
    this.status = status;
    this.code = body?.error_code ?? body?.error;
  }
}

function requireEnv(): { url: string; publishableKey: string; serviceRoleKey: string } {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !publishableKey || !serviceRoleKey) {
    throw new Error("Missing Supabase environment variables for the GoTrue REST client.");
  }
  return { url, publishableKey, serviceRoleKey };
}

/**
 * POSTs to `${SUPABASE_URL}/auth/v1/<path>` with the service role as the
 * bearer credential (captcha-exempt) and the publishable key as `apikey`.
 * Returns the parsed JSON body regardless of status; callers decide what a
 * non-2xx response means for their flow (e.g. "confirmation required" vs.
 * "wrong password" are both 4xx from GoTrue but mean different things).
 */
export async function goTrueRequest<T>(
  path: string,
  body: Record<string, unknown>,
  init: { fetchImpl?: typeof fetch } = {},
): Promise<{ ok: boolean; status: number; data: T | null; error: GoTrueErrorBody | null }> {
  const { url, publishableKey, serviceRoleKey } = requireEnv();
  const doFetch = init.fetchImpl ?? fetch;

  const response = await doFetch(`${url}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: publishableKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json().catch(() => null)) as (T & GoTrueErrorBody) | null;
  if (response.ok) {
    return { ok: true, status: response.status, data: json as T, error: null };
  }
  return { ok: false, status: response.status, data: null, error: json };
}
