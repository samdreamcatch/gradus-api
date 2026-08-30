import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getUserDetail,
  setUserTestFlag,
  adminUpdateUserFields,
  adminSearchParents,
  adminSetAthleteParent,
  adminDeleteUserHard,
} from "@/lib/admin.functions";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Chip } from "@/components/ui/chip";
import { Tag } from "@/components/ui/tag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ImpersonateButton } from "@/components/admin/impersonate-button";
import { GuardianInviteControls } from "@/components/admin/guardian-invite-controls";
import { PlanShareLinks } from "@/components/admin/plan-share-links";

export const Route = createFileRoute("/_authenticated/admin/users/$userId")({
  component: UserDetail,
});

function UserDetail() {
  const { userId } = Route.useParams();
  const navigate = useNavigate();
  const fn = useServerFn(getUserDetail);
  const toggleFn = useServerFn(setUserTestFlag);
  const hardDeleteFn = useServerFn(adminDeleteUserHard);
  const [deleting, setDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-user", userId],
    queryFn: () => fn({ data: { userId } }),
  });


  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
      <Link
        to="/admin/users"
        className="text-sm text-accent-ink underline-offset-4 hover:underline"
      >
        ← Back to admin
      </Link>

      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

      {data && (
        <>
          <header className="rounded-xl border border-divider bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Eyebrow size="small" tone="tertiary" weight="normal" tracking="wide">
                  Auth user
                </Eyebrow>
                <h1 className="mt-1 font-display text-h2 text-text-primary">
                  {data.auth?.email ?? "(no email)"}
                  {data.isTest && (
                    <Tag size="caption" className="ml-2 align-middle">
                      test user
                    </Tag>
                  )}
                </h1>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-2">
                <ImpersonateButton userId={userId} email={data.auth?.email ?? ""} />
                <Chip as="button" tone="muted" onClick={() => setEditOpen(true)}>
                  Edit user
                </Chip>

                {(data.coach || data.parent || data.athlete) && (
                  <Chip
                    as="button"
                    tone="muted"
                    selected={data.isTest}
                    onClick={async () => {
                      await toggleFn({ data: { userId, isTest: !data.isTest } });
                      await refetch();
                    }}
                  >
                    {data.isTest ? "Unmark test user" : "Mark as test user"}
                  </Chip>
                )}

                <Chip
                  as="button"
                  tone="destructive"
                  disabled={deleting}
                  className="disabled:opacity-50"
                  onClick={() => {
                    setConfirmText("");
                    setDangerOpen(true);
                  }}
                >
                  {deleting ? "Deleting…" : "Delete user"}
                </Chip>

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
              <Field
                label="Last active"
                value={(() => {
                  const seen =
                    (data.coach as any)?.last_seen_at ?? (data.parent as any)?.last_seen_at ?? null;
                  return seen ? new Date(seen).toLocaleString() : "Never";
                })()}
              />
            </dl>
          </header>

          {data.coach && (
            <section className="rounded-xl border border-divider bg-card p-5 space-y-3">
              <h2 className="font-display text-h3 text-text-primary">Coach profile</h2>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Field
                  label="Name"
                  value={
                    `${data.coach.first_name ?? ""} ${data.coach.last_name ?? ""}`.trim() || "—"
                  }
                />
                <Field
                  label="Onboarded"
                  value={
                    data.coach.onboarded_at
                      ? new Date(data.coach.onboarded_at).toLocaleDateString()
                      : "No"
                  }
                />
                <Field
                  label="Active plans"
                  value={`${data.coach.activePlansCount} / ${data.coach.plansCount}`}
                />
                <Field label="Sports" value={(data.coach.sports as string[]).join(", ") || "—"} />
              </dl>
              <PlanShareLinks plans={(data.coach.activePlans as any[]) ?? []} />
              <CodeList
                label="Coach invite code"
                codes={
                  data.coach.inviteCode
                    ? [{ code: data.coach.inviteCode as string, note: "share with athletes/parents" }]
                    : []
                }
              />
              <div>
                <Eyebrow size="small" tone="tertiary" weight="normal" tracking="wide">
                  Athletes ({(data.coach.athletes as any[]).length})
                </Eyebrow>
                <ul className="mt-1 text-sm text-text-primary">
                  {(data.coach.athletes as any[]).map((a) => (
                    <li key={a.id}>
                      • {a.first_name} {a.last_name}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {data.parent && (
            <section className="rounded-xl border border-divider bg-card p-5 space-y-3">
              <h2 className="font-display text-h3 text-text-primary">Parent profile</h2>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Field
                  label="Name"
                  value={
                    `${data.parent.first_name ?? ""} ${data.parent.last_name ?? ""}`.trim() || "—"
                  }
                />
                <Field
                  label="Coach link"
                  value={data.parent.coach_id ? "Linked" : "Beta (no coach)"}
                />
                <Field label="Sports" value={((data.parent.sports as string[]) ?? []).join(", ") || "—"} />
                <Field
                  label="Active plans"
                  value={`${data.parent.activePlansCount} / ${data.parent.plansCount}`}
                />
              </dl>
              <PlanShareLinks plans={(data.parent.activePlans as any[]) ?? []} />
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
              <CodeList
                label="Invite codes"
                codes={[
                  ...(data.parent.inviteCode
                    ? [{ code: data.parent.inviteCode as string, note: "give to a coach" }]
                    : []),
                  ...((data.parent.athleteCodes as any[]) ?? []).map((c) => ({
                    code: c.code as string,
                    note: `${c.athleteName} login${c.claimed ? " (claimed)" : ""}`,
                  })),
                ]}
              />
            </section>
          )}

          {data.athlete && (
            <section className="rounded-xl border border-divider bg-card p-5 space-y-3">
              <h2 className="font-display text-h3 text-text-primary">
                Athlete profile
                {data.athlete.self_managed && (
                  <Tag size="caption" className="ml-2">
                    adult
                  </Tag>
                )}
              </h2>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Field
                  label="Name"
                  value={
                    `${data.athlete.first_name ?? ""} ${data.athlete.last_name ?? ""}`.trim() || "—"
                  }
                />
                <Field label="Birthdate" value={data.athlete.birthdate ?? "—"} />
                <Field
                  label="Managed by"
                  value={
                    data.athlete.self_managed
                      ? "Self (adult)"
                      : data.athlete.parent_id
                        ? "Parent"
                        : "—"
                  }
                />
                <Field
                  label="Active plans"
                  value={`${data.athlete.activePlansCount} / ${data.athlete.plansCount}`}
                />
                <Field
                  label="Sports"
                  value={((data.athlete.sports as string[]) ?? []).join(", ") || "—"}
                />
                <Field
                  label="Parent / guardian email"
                  value={(data.athlete.guardian_email as string | null) ?? "None on file"}
                />
                <Field
                  label="Guardian status"
                  value={
                    data.athlete.guardian_claimed_at || data.athlete.parent_id
                      ? `Claimed${data.athlete.guardianParentName ? ` — ${data.athlete.guardianParentName}` : ""}`
                      : data.athlete.guardian_invited_at
                        ? `Invited ${new Date(data.athlete.guardian_invited_at as string).toLocaleDateString()}`
                        : "Not invited"
                  }
                />
              </dl>
              {!data.athlete.parent_id && !data.athlete.guardian_claimed_at && (
                <div className="rounded-lg border border-divider bg-elevated p-4">
                  <GuardianInviteControls athleteId={data.athlete.id as string} />
                </div>
              )}
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
              <PlanShareLinks plans={(data.athlete.activePlans as any[]) ?? []} />
              <CodeList
                label="Invite codes"
                codes={[
                  ...(data.athlete.inviteCode
                    ? [{ code: data.athlete.inviteCode as string, note: "give to a coach" }]
                    : []),
                  ...(data.athlete.claimCode
                    ? [
                        {
                          code: (data.athlete.claimCode as any).code as string,
                          note: `athlete login${(data.athlete.claimCode as any).claimed ? " (claimed)" : ""}`,
                        },
                      ]
                    : []),
                ]}
              />
            </section>
          )}

          {!data.coach && !data.parent && !data.athlete && (
            <p className="rounded-xl border border-divider bg-card p-5 text-sm text-text-secondary">
              No coach, parent, or athlete profile (likely an admin-only account).
            </p>
          )}

          <EditUserSheet
            open={editOpen}
            onOpenChange={setEditOpen}
            userId={userId}
            detail={data}
            onSaved={() => refetch()}
          />

          <AlertDialog open={dangerOpen} onOpenChange={setDangerOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Permanently delete this user?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes {data.auth?.email ?? "this account"} and all of their profile rows
                  so the email can be reused. This cannot be undone. Type the email to confirm.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={data.auth?.email ?? "email"}
                autoComplete="off"
              />
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleting || confirmText.trim().length === 0}
                  onClick={async (e) => {
                    e.preventDefault();
                    setDeleting(true);
                    try {
                      await hardDeleteFn({ data: { userId, confirm: confirmText.trim() } });
                      toast.success("User deleted");
                      navigate({ to: "/admin/users" });
                    } catch (err: any) {
                      toast.error(err?.message ?? "Failed to delete user");
                      setDeleting(false);
                    }
                  }}
                >
                  {deleting ? "Deleting…" : "Delete permanently"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}

    </div>
  );
}

function CodeList({
  label,
  codes,
}: {
  label: string;
  codes: { code: string; note?: string }[];
}) {
  return (
    <div>
      <Eyebrow size="small" tone="tertiary" weight="normal" tracking="wide">
        {label}
      </Eyebrow>
      {codes.length === 0 ? (
        <p className="mt-1 text-sm text-text-secondary">None yet</p>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-2">
          {codes.map((c) => (
            <li key={`${c.code}-${c.note ?? ""}`}>
              <Chip
                as="button"
                tone="muted"
                onClick={() => {
                  navigator.clipboard?.writeText(c.code);
                  toast.success(`Copied ${c.code}`);
                }}
              >
                <span className="font-mono">{c.code}</span>
                {c.note ? <span className="ml-2 text-text-secondary">{c.note}</span> : null}
              </Chip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <Eyebrow as="dt" size="small" tone="tertiary" weight="normal" tracking="wide">
        {label}
      </Eyebrow>
      <dd className={`text-sm text-text-primary ${mono ? "font-mono break-all" : ""}`}>{value}</dd>
    </div>
  );
}

function EditUserSheet({
  open,
  onOpenChange,
  userId,
  detail,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  detail: any;
  onSaved: () => void;
}) {
  const updateFn = useServerFn(adminUpdateUserFields);
  const searchParentsFn = useServerFn(adminSearchParents);
  const setParentFn = useServerFn(adminSetAthleteParent);

  const profile = detail.coach ?? detail.parent ?? detail.athlete ?? null;
  const athlete = detail.athlete;

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [username, setUsername] = useState("");
  const [parentQuery, setParentQuery] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFirstName(profile?.first_name ?? "");
    setLastName(profile?.last_name ?? "");
    setEmail(detail.auth?.email ?? "");
    setBirthdate(athlete?.birthdate ?? "");
    setGuardianEmail(athlete?.guardian_email ?? "");
    setUsername(athlete?.username ?? "");
    setParentQuery("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parentsQ = useQuery({
    queryKey: ["admin-parent-search", parentQuery],
    queryFn: () => searchParentsFn({ data: { query: parentQuery } }),
    enabled: open && !!athlete,
  });

  const save = async () => {
    setSaving(true);
    try {
      await updateFn({
        data: {
          userId,
          ...(profile ? { firstName: firstName.trim(), lastName: lastName.trim() } : {}),
          ...(email.trim() && email.trim() !== (detail.auth?.email ?? "")
            ? { email: email.trim() }
            : {}),
          ...(athlete
            ? {
                birthdate: birthdate.trim() ? birthdate.trim() : null,
                guardianEmail: guardianEmail.trim() ? guardianEmail.trim() : null,
                username: username.trim() ? username.trim() : null,
              }
            : {}),
        },
      });
      toast.success("User updated");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update user");
    } finally {
      setSaving(false);
    }
  };

  const relink = async (parentId: string | null) => {
    try {
      await setParentFn({ data: { athleteId: athlete.id, parentId } });
      toast.success(parentId ? "Athlete linked to parent" : "Athlete set to self-managed");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update link");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit user</SheetTitle>
          <SheetDescription>Correct account details. Changes apply immediately.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {profile && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="edit-first">First name</Label>
                <Input
                  id="edit-first"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="edit-last">Last name</Label>
                <Input
                  id="edit-last"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="edit-email">Login email</Label>
            <Input
              id="edit-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {athlete && (
            <>
              <div>
                <Label htmlFor="edit-dob">Birthdate</Label>
                <Input
                  id="edit-dob"
                  type="date"
                  value={birthdate}
                  onChange={(e) => setBirthdate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="edit-guardian">Parent / guardian email</Label>
                <Input
                  id="edit-guardian"
                  type="email"
                  value={guardianEmail}
                  onChange={(e) => setGuardianEmail(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="edit-username">Username</Label>
                <Input
                  id="edit-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </>
          )}

          <Button onClick={save} disabled={saving} className="w-full">
            {saving ? "Saving…" : "Save changes"}
          </Button>

          {athlete && (
            <div className="space-y-2 border-t border-divider pt-4">
              <Eyebrow size="small" tone="tertiary" weight="normal" tracking="wide">
                Managed by
              </Eyebrow>
              <p className="text-sm text-text-secondary">
                {athlete.parent_id
                  ? `Parent${athlete.guardianParentName ? ` — ${athlete.guardianParentName}` : ""}`
                  : "Self-managed"}
              </p>
              {athlete.parent_id ? (
                <Chip as="button" tone="muted" onClick={() => relink(null)}>
                  Detach — make self-managed
                </Chip>
              ) : (
                <>
                  <Input
                    value={parentQuery}
                    onChange={(e) => setParentQuery(e.target.value)}
                    placeholder="Search parents by name"
                  />
                  <ul className="max-h-48 space-y-1 overflow-y-auto">
                    {(parentsQ.data?.parents ?? []).map((p) => (
                      <li key={p.id}>
                        <Chip as="button" tone="muted" onClick={() => relink(p.id)}>
                          Link to {p.name}
                        </Chip>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
