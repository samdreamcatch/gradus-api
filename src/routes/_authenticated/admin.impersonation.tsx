import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { listAllUsers } from "@/lib/admin.functions";
import { listImpersonationEvents } from "@/lib/impersonation.functions";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { ImpersonateButton } from "@/components/admin/impersonate-button";

export const Route = createFileRoute("/_authenticated/admin/impersonation")({
  component: ImpersonationPage,
});

function ImpersonationPage() {
  const [q, setQ] = useState("");
  const search = q.trim();
  const usersFn = useServerFn(listAllUsers);
  const eventsFn = useServerFn(listImpersonationEvents);

  const users = useQuery({
    queryKey: ["admin-impersonation-users", search],
    queryFn: () => usersFn({ data: { search, hideTest: false } }),
    enabled: search.length >= 2,
  });

  const events = useQuery({
    queryKey: ["admin-impersonation-events"],
    queryFn: () => eventsFn(),
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      <header>
        <Eyebrow size="small" tone="tertiary" weight="normal" tracking="wide">
          Admin
        </Eyebrow>
        <h1 className="mt-1 font-display text-h2 text-text-primary">Impersonation</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Sign in as a user to debug a support ticket. Your admin session is replaced for this tab —
          use “End session” in the banner and sign back in when you're done. Admin accounts can't be
          impersonated, and every session is audit-logged below.
        </p>
      </header>

      <section className="rounded-xl border border-divider bg-card p-5 space-y-4">
        <Eyebrow size="small" tone="tertiary" weight="normal" tracking="wide">
          Find a user
        </Eyebrow>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or email…"
          autoCapitalize="none"
          spellCheck={false}
        />
        {search.length >= 2 && users.isLoading && (
          <p className="text-sm text-text-secondary">Searching…</p>
        )}
        {users.error && <p className="text-sm text-destructive">{(users.error as Error).message}</p>}
        {users.data && users.data.rows.length === 0 && (
          <p className="text-sm text-text-secondary">No users match “{search}”.</p>
        )}
        <ul className="divide-y divide-divider">
          {(users.data?.rows ?? []).slice(0, 25).map((r) => (
            <li key={r.userId} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <Link
                  to="/admin/users/$userId"
                  params={{ userId: r.userId }}
                  className="block truncate text-sm font-semibold text-accent-ink underline-offset-4 hover:underline"
                >
                  {r.name || "(no name)"}
                </Link>
                <p className="truncate text-xs text-text-secondary">
                  {r.email} · {r.userType}
                </p>
              </div>
              {r.isAdmin ? (
                <Chip tone="muted">admin</Chip>
              ) : (
                <ImpersonateButton
                  userId={r.userId}
                  email={r.email ?? ""}
                  onStarted={() => toast.success("Starting session…")}
                />
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-divider bg-card p-5 space-y-3">
        <Eyebrow size="small" tone="tertiary" weight="normal" tracking="wide">
          Audit log
        </Eyebrow>
        {events.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
        {events.data && events.data.events.length === 0 && (
          <p className="text-sm text-text-secondary">No impersonation sessions yet.</p>
        )}
        <ul className="divide-y divide-divider">
          {(events.data?.events ?? []).map((e) => (
            <li key={e.id} className="py-2 text-sm">
              <span className="text-text-primary">{e.admin_email ?? "admin"}</span>
              <span className="text-text-secondary"> viewed as </span>
              <span className="text-text-primary">{e.target_email ?? e.target_user_id}</span>
              <span className="block text-xs text-text-tertiary">
                {new Date(e.created_at).toLocaleString()}
                {e.reason ? ` · ${e.reason}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
