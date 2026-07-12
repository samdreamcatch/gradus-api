// Server-only helper: fetch template copy overrides. Used by the auth webhook
// and transactional send route to apply DB-stored copy at render time.
// Uses the admin/service-role client (already scoped to the server webhook module).

export async function fetchOverridesFor(templateName: string): Promise<Record<string, string>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("email_template_overrides")
    .select("slot_key, value")
    .eq("template_name", templateName);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const row of data as Array<{ slot_key: string; value: string }>) {
    out[row.slot_key] = row.value;
  }
  return out;
}

export function resolveSubject(
  templateName: string,
  overrides: Record<string, string>,
  fallback: string,
): string {
  return overrides.subject ?? fallback;
}
