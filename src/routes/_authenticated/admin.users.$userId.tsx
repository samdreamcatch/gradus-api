import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { getUserDetail, setUserTestFlag, deleteTestUser } from "@/lib/admin.functions";
import { Eyebrow } from "@/components/ui/eyebrow";

export const Route = createFileRoute("/_authenticated/admin/users/$userId")({
  component: UserDetail,
});

function UserDetail() {
  const { userId } = Route.useParams();
  const navigate = useNavigate();
  const fn = useServerFn(getUserDetail);
  const toggleFn = useServerFn(setUserTestFlag);
  const deleteFn = useServerFn(deleteTestUser);
  const [deleting, setDeleting] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-user", userId],
    queryFn: () => fn({ data: { userId } }),
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
      <Link to="/admin" className="text-sm text-accent-ink underline-offset-4 hover:underline">
        ← Back to admin
      </Link>

      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

      {data && (
        <>
          <header className="rounded-xl border border-divider bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Eyebrow size="small" tone="tertiary" weight="normal" tracking="wide">Auth user</Eyebrow>
                <h1 className="mt-1 font-display text-h2 text-text-primary">
                  {data.auth?.email ?? "(no email)"}
                  {data.isTest && (
                    <span className="ml-2 align-middle rounded-pill border border-divider bg-elevated px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider text-text-tertiary">test user</span>
                  )}
                </h1>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-2">
                {(data.coach || data.parent || data.athlete) && (
                  <button
                    type="button"
                    onClick={async () => {
                      await toggleFn({ data: { userId, isTest: !data.isTest } });
                      await refetch();
                    }}
                    className={`rounded-pill border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
                      data.isTest
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-divider bg-card text-text-secondary hover:bg-elevated"
                    }`}
                  >
                    {data.isTest ? "Unmark test user" : "Mark as test user"}
                  </button>
                )}
                {data.isTest && (
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={async () => {
                      const email = data.auth?.email ?? "this user";
                      if (!confirm(`Permanently delete ${email}? This removes their account and profiles so the email can be reused. This cannot be undone.`)) return;
                      setDeleting(true);
                      try {
                        await deleteFn({ data: { userId } });
                        toast.success("Test user deleted");
                        navigate({ to: "/admin" });
                      } catch (e: any) {
                        toast.error(e?.message ?? "Failed to delete user");
                        setDeleting(false);
                      }
                    }}
                    className="rounded-pill border border-destructive/50 bg-card px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-destructive transition hover:bg-destructive hover:text-white disabled:opacity-50"
                  >
                    {deleting ? "Deleting…" : "Delete user"}
                  </button>
                )}
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <Field label="User ID" value={data.auth?.id ?? "—"} mono />
              <Field label="Provider" value={data.auth?.provider ?? "—"} />
              <Field
                label="Created"
                value={data.auth?.createdAt ? new Date(data.auth.createdAt).toLocaleString() : "—"}
              />
              <Field
                label="Last sign-in"
                value={
                  data.auth?.lastSignInAt
                    ? new Date(data.auth.lastSignInAt).toLocaleString()
                    : "Never"
                }
              />
            </dl>
          </header>

          {data.coach && (
            <section className="rounded-xl border border-divider bg-card p-5 space-y-3">
              <h2 className="font-display text-h3 text-text-primary">Coach profile</h2>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Name" value={`${data.coach.first_name ?? ""} ${data.coach.last_name ?? ""}`.trim() || "—"} />
                <Field label="Onboarded" value={data.coach.onboarded_at ? new Date(data.coach.onboarded_at).toLocaleDateString() : "No"} />
                <Field label="Active plans" value={`${data.coach.activePlansCount} / ${data.coach.plansCount}`} />
                <Field label="Sports" value={(data.coach.sports as string[]).join(", ") || "—"} />
              </dl>
              <div>
                <Eyebrow size="small" tone="tertiary" weight="normal" tracking="wide">
                  Athletes ({(data.coach.athletes as any[]).length})
                </Eyebrow>
                <ul className="mt-1 text-sm text-text-primary">
                  {(data.coach.athletes as any[]).map((a) => (
                    <li key={a.id}>• {a.first_name} {a.last_name}</li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {data.parent && (
            <section className="rounded-xl border border-divider bg-card p-5 space-y-3">
              <h2 className="font-display text-h3 text-text-primary">Parent profile</h2>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Name" value={`${data.parent.first_name ?? ""} ${data.parent.last_name ?? ""}`.trim() || "—"} />
                <Field label="Coach link" value={data.parent.coach_id ? "Linked" : "Beta (no coach)"} />
              </dl>
              <div>
                <Eyebrow size="small" tone="tertiary" weight="normal" tracking="wide">
                  Athletes ({(data.parent.athletes as any[]).length})
                </Eyebrow>
                <ul className="mt-1 text-sm text-text-primary">
                  {(data.parent.athletes as any[]).map((a) => (
                    <li key={a.id}>
                      • {a.first_name} {a.last_name}
                      {a.birthdate ? ` (${a.birthdate})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {data.athlete && (
            <section className="rounded-xl border border-divider bg-card p-5 space-y-3">
              <h2 className="font-display text-h3 text-text-primary">
                Athlete profile
                {data.athlete.self_managed && (
                  <span className="ml-2 rounded-pill border border-divider bg-elevated px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider text-text-tertiary">adult</span>
                )}
              </h2>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Name" value={`${data.athlete.first_name ?? ""} ${data.athlete.last_name ?? ""}`.trim() || "—"} />
                <Field label="Birthdate" value={data.athlete.birthdate ?? "—"} />
                <Field label="Managed by" value={data.athlete.self_managed ? "Self (adult)" : data.athlete.parent_id ? "Parent" : "—"} />
                <Field label="Active plans" value={`${data.athlete.activePlansCount} / ${data.athlete.plansCount}`} />
              </dl>
              <div>
                <Eyebrow size="small" tone="tertiary" weight="normal" tracking="wide">
                  Coaches ({(data.athlete.coaches as any[]).length})
                </Eyebrow>
                <ul className="mt-1 text-sm text-text-primary">
                  {(data.athlete.coaches as any[]).map((c, i) => (
                    <li key={i}>
                      • {c.coachName}
                      {c.sport ? ` (${c.sport})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {!data.coach && !data.parent && !data.athlete && (
            <p className="rounded-xl border border-divider bg-card p-5 text-sm text-text-secondary">
              No coach, parent, or athlete profile (likely an admin-only account).
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <Eyebrow as="dt" size="small" tone="tertiary" weight="normal" tracking="wide">{label}</Eyebrow>
      <dd className={`text-sm text-text-primary ${mono ? "font-mono break-all" : ""}`}>{value}</dd>
    </div>
  );
}
