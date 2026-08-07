import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  getOrgAdminContext,
  listOrgRoster,
  removeCoachFromOrg,
  listOrgCoachInvites,
  createOrgCoachInvite,
  revokeOrgCoachInvite,
} from "@/lib/org-admin.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageTitle } from "@/components/page-title";

export const Route = createFileRoute("/_authenticated/org-admin/roster")({
  component: OrgRosterPage,
});

function OrgRosterPage() {
  const ctxFn = useServerFn(getOrgAdminContext);
  const rosterFn = useServerFn(listOrgRoster);
  const invitesFn = useServerFn(listOrgCoachInvites);
  const createInviteFn = useServerFn(createOrgCoachInvite);
  const revokeInviteFn = useServerFn(revokeOrgCoachInvite);
  const removeFn = useServerFn(removeCoachFromOrg);
  const qc = useQueryClient();

  const ctxQ = useQuery({ queryKey: ["org-admin-ctx"], queryFn: () => ctxFn() });
  const orgId = ctxQ.data?.organizations[0]?.id;
  const orgName = ctxQ.data?.organizations[0]?.name ?? "";

  const rosterQ = useQuery({
    queryKey: ["org-roster", orgId],
    queryFn: () => rosterFn({ data: { organizationId: orgId! } }),
    enabled: !!orgId,
  });
  const invitesQ = useQuery({
    queryKey: ["org-invites", orgId],
    queryFn: () => invitesFn({ data: { organizationId: orgId! } }),
    enabled: !!orgId,
  });

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const createInvite = useMutation({
    mutationFn: () => createInviteFn({ data: { organizationId: orgId!, email, phone } }),
    onSuccess: (res) => {
      toast.success(`Invite created — code ${res.code}`);
      setEmail("");
      setPhone("");
      qc.invalidateQueries({ queryKey: ["org-invites", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeInvite = useMutation({
    mutationFn: (id: string) => revokeInviteFn({ data: { organizationId: orgId!, inviteId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-invites", orgId] }),
  });

  const removeCoach = useMutation({
    mutationFn: (coachId: string) => removeFn({ data: { organizationId: orgId!, coachId } }),
    onSuccess: () => {
      toast.success("Coach removed from org");
      qc.invalidateQueries({ queryKey: ["org-roster", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!orgId) return <div className="p-6 text-text-secondary">Loading…</div>;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl">
      <PageTitle>{`${orgName} — Roster`}</PageTitle>

      <Card>
        <CardHeader>
          <CardTitle>Invite a coach</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="inv-email">Email (optional)</Label>
              <Input
                id="inv-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="coach@example.com"
              />
            </div>
            <div>
              <Label htmlFor="inv-phone">Phone (optional)</Label>
              <Input
                id="inv-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 555 5555"
              />
            </div>
          </div>
          <Button
            onClick={() => createInvite.mutate()}
            disabled={createInvite.isPending || (!email && !phone)}
          >
            {createInvite.isPending ? "Creating…" : "Create invite"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending invites</CardTitle>
        </CardHeader>
        <CardContent>
          {(invitesQ.data?.invites ?? []).length === 0 ? (
            <p className="text-sm text-text-secondary">No invites yet.</p>
          ) : (
            <div className="divide-y divide-divider">
              {invitesQ.data!.invites.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-mono">{inv.code}</p>
                    <p className="text-text-secondary truncate">{inv.email ?? inv.phone ?? "—"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{inv.status}</Badge>
                    {inv.status === "pending" && (
                      <Button variant="ghost" size="sm" onClick={() => revokeInvite.mutate(inv.id)}>
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Coaches ({rosterQ.data?.coaches.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {(rosterQ.data?.coaches ?? []).length === 0 ? (
            <p className="text-sm text-text-secondary">No coaches yet.</p>
          ) : (
            <div className="divide-y divide-divider">
              {rosterQ.data!.coaches.map((c) => (
                <div
                  key={c.coachId}
                  className="flex items-center justify-between py-3 text-sm gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {c.firstName} {c.lastName}
                    </p>
                    <p className="text-text-secondary truncate">{c.email ?? "—"}</p>
                  </div>
                  <div className="hidden sm:flex items-center gap-4 text-text-secondary shrink-0">
                    <span>{c.athleteCount} athletes</span>
                    <span>{c.parentCount} parents</span>
                    <span>{c.adultAthleteCount} adult</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm(`Remove ${c.firstName} ${c.lastName} from ${orgName}?`)) {
                        removeCoach.mutate(c.coachId);
                      }
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
