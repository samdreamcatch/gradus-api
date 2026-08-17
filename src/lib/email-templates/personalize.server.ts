// Resolves real per-user data (role + first name) for an email recipient so
// manual sends and previews use the actual person's details instead of the
// generic sample props.

export type RecipientRole = "coach" | "parent" | "athlete";

export interface RecipientPersonalization {
  role: RecipientRole | null;
  firstName: string | null;
  userId: string | null;
  email: string;
}

/**
 * Look up an app user by email address and resolve their role and first name.
 * Returns nulls when the address does not belong to an app user (e.g. the
 * support test address) so callers can fall back to sample data.
 */
export async function resolveRecipientPersonalization(
  admin: any,
  email: string,
): Promise<RecipientPersonalization> {
  const normalized = email.trim().toLowerCase();
  const result: RecipientPersonalization = {
    role: null,
    firstName: null,
    userId: null,
    email: normalized,
  };

  try {
    const { data: page } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const user = (page?.users ?? []).find(
      (u: { email?: string | null }) => (u.email ?? "").toLowerCase() === normalized,
    );
    if (!user) return result;
    result.userId = user.id as string;

    const [coach, parent, athlete] = await Promise.all([
      admin.from("coach_profiles").select("first_name").eq("user_id", user.id).maybeSingle(),
      admin.from("parent_profiles").select("first_name").eq("user_id", user.id).maybeSingle(),
      admin.from("athletes").select("first_name").eq("user_id", user.id).maybeSingle(),
    ]);

    if (coach?.data) {
      result.role = "coach";
      result.firstName = (coach.data.first_name as string) ?? null;
    } else if (parent?.data) {
      result.role = "parent";
      result.firstName = (parent.data.first_name as string) ?? null;
    } else if (athlete?.data) {
      result.role = "athlete";
      result.firstName = (athlete.data.first_name as string) ?? null;
    }
  } catch (err) {
    console.error("[email-personalize] lookup failed", err);
  }

  return result;
}
