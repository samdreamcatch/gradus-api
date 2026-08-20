import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowUpDown, KeyRound, MoreHorizontal, Trash2, Undo2, Ticket } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Tag } from "@/components/ui/tag";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OrgSearchCombobox, type OrgOption } from "@/components/onboarding/org-search-combobox";
import {
  listAllUsers,
  adminResetPassword,
  adminSoftDeleteUser,
  adminRestoreUser,
  adminSetUserOrg,
  adminSetOrgAdmin,
  adminApplyPromoCode,
  adminRemovePromoCode,
  listActivePromoCodes,
  setUserTestFlag,
  deleteTestUser,
} from "@/lib/admin.functions";

const searchSchema = z.object({
  q: fallback(z.string(), "").default(""),
  types: fallback(z.array(z.string()), []).default([]),
  plans: fallback(z.array(z.string()), []).default([]),
  onlyAdmin: fallback(z.boolean(), false).default(false),
  onlyOrgAdmin: fallback(z.boolean(), false).default(false),
  onlyTest: fallback(z.boolean(), false).default(false),
  hideTest: fallback(z.boolean(), true).default(true),
  includeDeleted: fallback(z.boolean(), false).default(false),
  sort: fallback(z.string(), "created_desc").default("created_desc"),
});

export const Route = createFileRoute("/_authenticated/admin/users/")({
  validateSearch: zodValidator(searchSchema),
  component: AdminUsersPage,
});

type UserType =
  | "coach"
  | "parent"
  | "youth_athlete"
  | "adult_athlete"
  | "minor_athlete"
  | "awaiting_parent"
  | "internal_admin"
  | "unknown";

const USER_TYPE_LABEL: Record<UserType, string> = {
  coach: "Coach",
  parent: "Parent",
  youth_athlete: "Youth athlete",
  adult_athlete: "Adult athlete (18+)",
  minor_athlete: "Self-managed athlete (minor)",
  awaiting_parent: "Awaiting parent connection",
  internal_admin: "Internal admin",
  unknown: "Unknown",
};

const PLAN_LABEL: Record<string, string> = {
  coach: "Coach",
  coach_pro: "Coach Pro",
  club: "Club",
};

function AdminUsersPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listAllUsers);

  const listQuery = useQuery({
    queryKey: ["admin-users", search],
    queryFn: () =>
      listFn({
        data: {
          search: search.q,
          types: search.types,
          plans: search.plans,
          onlyAdmin: search.onlyAdmin,
          onlyOrgAdmin: search.onlyOrgAdmin,
          onlyTest: search.onlyTest,
          hideTest: search.hideTest,
          includeDeleted: search.includeDeleted,
        },
      }),
  });

  const rows = useMemo(() => {
    const list = listQuery.data?.rows ?? [];
    const [key, dir] = search.sort.split("_");
    const mul = dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const av =
        key === "name"
          ? a.name.toLowerCase()
          : key === "email"
            ? (a.email ?? "").toLowerCase()
            : key === "lastSignIn"
              ? (a.lastSignInAt ?? "")
              : a.createdAt;
      const bv =
        key === "name"
          ? b.name.toLowerCase()
          : key === "email"
            ? (b.email ?? "").toLowerCase()
            : key === "lastSignIn"
              ? (b.lastSignInAt ?? "")
              : b.createdAt;
      return av < bv ? -1 * mul : av > bv ? mul : 0;
    });
  }, [listQuery.data, search.sort]);

  const [localQuery, setLocalQuery] = useState(search.q);

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    navigate({ search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, ...patch }) });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-users"] });

  const typeOptions: UserType[] = [
    "coach",
    "parent",
    "youth_athlete",
    "adult_athlete",
    "minor_athlete",
    "awaiting_parent",
    "internal_admin",
  ];

  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const activeUser = rows.find((r) => r.userId === activeUserId) ?? null;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 space-y-6">
      <header className="space-y-1">
        <Eyebrow size="small" tone="accent-ink">
          Membership
        </Eyebrow>
        <h1 className="font-display text-h1 text-text-primary">Users</h1>
        <p className="text-sm text-text-secondary">
          Every account in one table. Sort, filter, and manage.
        </p>
      </header>

      {/* Filters */}
      <section className="rounded-xl border border-divider bg-card p-4 space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch({ q: localQuery.trim() });
          }}
          className="flex flex-wrap gap-2"
        >
          <Input
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            placeholder="Search name, email, or organization"
            className="w-64"
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>

          <div className="flex flex-wrap items-center gap-1 ml-2">
            <span className="text-xs uppercase tracking-wide text-text-tertiary mr-1">Type</span>
            {typeOptions.map((t) => {
              const selected = search.types.includes(t);
              return (
                <Chip
                  key={t}
                  as="button"
                  size="micro"
                  selected={selected}
                  onClick={(e) => {
                    e.preventDefault();
                    const next = selected
                      ? search.types.filter((x: string) => x !== t)
                      : [...search.types, t];
                    setSearch({ types: next });
                  }}
                >
                  {USER_TYPE_LABEL[t]}
                </Chip>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1 ml-2">
            <span className="text-xs uppercase tracking-wide text-text-tertiary mr-1">Plan</span>
            {["coach", "coach_pro", "club"].map((p) => {
              const selected = search.plans.includes(p);
              return (
                <Chip
                  key={p}
                  as="button"
                  size="micro"
                  selected={selected}
                  onClick={(e) => {
                    e.preventDefault();
                    const next = selected
                      ? search.plans.filter((x: string) => x !== p)
                      : [...search.plans, p];
                    setSearch({ plans: next });
                  }}
                >
                  {PLAN_LABEL[p]}
                </Chip>
              );
            })}
          </div>
        </form>

        <div className="flex flex-wrap items-center gap-4 pt-1">
          <ToggleRow
            id="only-admin"
            label="Only internal admins"
            checked={search.onlyAdmin}
            onCheckedChange={(v) => setSearch({ onlyAdmin: v })}
          />
          <ToggleRow
            id="only-org-admin"
            label="Only org admins"
            checked={search.onlyOrgAdmin}
            onCheckedChange={(v) => setSearch({ onlyOrgAdmin: v })}
          />
          <ToggleRow
            id="only-test"
            label="Only test users"
            checked={search.onlyTest}
            onCheckedChange={(v) => setSearch({ onlyTest: v, hideTest: v ? false : true })}
          />
          <ToggleRow
            id="hide-test"
            label="Hide test users"
            checked={search.hideTest}
            onCheckedChange={(v) => setSearch({ hideTest: v })}
          />
          <ToggleRow
            id="include-deleted"
            label="Include deleted"
            checked={search.includeDeleted}
            onCheckedChange={(v) => setSearch({ includeDeleted: v })}
          />
        </div>
      </section>

      {/* Table */}
      <section className="rounded-xl border border-divider bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh
                  label="Name"
                  sortKey="name"
                  current={search.sort}
                  onSort={(s) => setSearch({ sort: s })}
                />
                <SortableTh
                  label="Email"
                  sortKey="email"
                  current={search.sort}
                  onSort={(s) => setSearch({ sort: s })}
                />
                <TableHead>Type</TableHead>
                <TableHead>Connected to</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead>Promo codes</TableHead>
                <SortableTh
                  label="Last login"
                  sortKey="lastSignIn"
                  current={search.sort}
                  onSort={(s) => setSearch({ sort: s })}
                />
                <SortableTh
                  label="Created"
                  sortKey="created"
                  current={search.sort}
                  onSort={(s) => setSearch({ sort: s })}
                />
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-sm text-text-secondary py-8 text-center">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-sm text-text-secondary py-8 text-center">
                    No users match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow
                    key={r.userId}
                    data-deleted={r.softDeletedAt ? "true" : undefined}
                    className="data-[deleted=true]:opacity-60"
                  >
                    <TableCell className="font-medium text-text-primary max-w-[220px]">
                      <div className="truncate">{r.name}</div>
                      {r.softDeletedAt && (
                        <Tag className="mt-1 bg-destructive/10 text-destructive">deleted</Tag>
                      )}
                    </TableCell>
                    <TableCell className="text-text-secondary max-w-[220px]">
                      <div className="truncate">{r.email ?? "—"}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs uppercase text-accent-ink whitespace-nowrap">
                      {USER_TYPE_LABEL[r.userType as UserType] ?? r.userType}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {r.planTier ? (PLAN_LABEL[r.planTier] ?? r.planTier) : "—"}
                    </TableCell>
                    <TableCell className="max-w-[180px]">
                      <div className="truncate">{r.organizationName ?? "—"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {r.isAdmin && <Tag>admin</Tag>}
                        {r.isOrgAdmin && <Tag>org admin</Tag>}
                        {r.isTest && <Tag>test</Tag>}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[180px]">
                      {r.appliedCodes.length === 0 && !r.stashedPromoCode ? (
                        <span className="text-text-tertiary">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.stashedPromoCode && <Tag>{r.stashedPromoCode}</Tag>}
                          {r.appliedCodes.map((c) => (
                            <Tag key={c.id}>
                              {c.code}
                              <span className="ml-1 text-[10px] opacity-70">
                                {c.scope === "active_now" ? "live" : "next"}
                              </span>
                            </Tag>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-text-tertiary whitespace-nowrap">
                      {r.lastSignInAt ? new Date(r.lastSignInAt).toLocaleDateString() : "never"}
                    </TableCell>
                    <TableCell className="text-xs text-text-tertiary whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <RowActions
                        userId={r.userId}
                        userType={r.userType}
                        isDeleted={!!r.softDeletedAt}
                        isTest={r.isTest}
                        onOpenManage={() => setActiveUserId(r.userId)}
                        onDone={invalidate}
                        email={r.email ?? ""}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="border-t border-divider px-4 py-2 text-xs text-text-tertiary flex items-center justify-between">
          <span>
            {rows.length} user{rows.length === 1 ? "" : "s"}
          </span>
          <Link
            to="/admin/list/$kind"
            params={{ kind: "coaches" }}
            className="text-accent-ink underline-offset-4 hover:underline"
          >
            Old list views →
          </Link>
        </div>
      </section>

      {activeUser && (
        <ManageUserSheet
          user={activeUser}
          onOpenChange={(o) => !o && setActiveUserId(null)}
          onDone={invalidate}
        />
      )}
    </div>
  );
}

function ToggleRow({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
      <Label htmlFor={id} className="text-xs text-text-secondary">
        {label}
      </Label>
    </div>
  );
}

function SortableTh({
  label,
  sortKey,
  current,
  onSort,
}: {
  label: string;
  sortKey: string;
  current: string;
  onSort: (s: string) => void;
}) {
  const [key, dir] = current.split("_");
  const isCurrent = key === sortKey;
  const nextDir = isCurrent && dir === "desc" ? "asc" : "desc";
  return (
    <TableHead>
      <button
        type="button"
        onClick={() => onSort(`${sortKey}_${nextDir}`)}
        className="inline-flex items-center gap-1 hover:text-text-primary"
      >
        {label}
        <ArrowUpDown className="size-3 opacity-60" />
        {isCurrent && <span className="text-[10px] opacity-70">{dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </TableHead>
  );
}

function RowActions({
  userId,
  userType,
  isDeleted,
  isTest,
  email,
  onOpenManage,
  onDone,
}: {
  userId: string;
  userType: string;
  isDeleted: boolean;
  isTest: boolean;
  email: string;
  onOpenManage: () => void;
  onDone: () => void;
}) {
  const resetFn = useServerFn(adminResetPassword);
  const restoreFn = useServerFn(adminRestoreUser);
  const toggleTestFn = useServerFn(setUserTestFlag);
  const hardDeleteFn = useServerFn(deleteTestUser);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmHardDelete, setConfirmHardDelete] = useState(false);

  const reset = useMutation({
    mutationFn: () => resetFn({ data: { userId } }),
    onSuccess: async (res) => {
      if (res.recoveryLink) {
        try {
          await navigator.clipboard.writeText(res.recoveryLink);
          toast.success("Reset email sent · link copied to clipboard");
        } catch {
          toast.success("Reset email sent");
        }
      } else {
        toast.success("Reset email sent");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restore = useMutation({
    mutationFn: () => restoreFn({ data: { userId } }),
    onSuccess: () => {
      toast.success("User restored");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onOpenManage}>
            <Ticket className="size-4 mr-2" />
            Manage user
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => reset.mutate()} disabled={reset.isPending || !email}>
            <KeyRound className="size-4 mr-2" />
            Reset password
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={async () => {
              await toggleTestFn({ data: { userId, isTest: true } }).catch(() => null);
              onDone();
            }}
          >
            Mark as test user
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={async () => {
              await toggleTestFn({ data: { userId, isTest: false } }).catch(() => null);
              onDone();
            }}
          >
            Unmark as test user
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {isDeleted ? (
            <DropdownMenuItem onClick={() => restore.mutate()} disabled={restore.isPending}>
              <Undo2 className="size-4 mr-2" />
              Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setConfirmDelete(true)} className="text-destructive">
              <Trash2 className="size-4 mr-2" />
              Soft delete
            </DropdownMenuItem>
          )}
          {isTest && !isDeleted && (
            <DropdownMenuItem
              onClick={() => setConfirmHardDelete(true)}
              className="text-destructive"
            >
              <Trash2 className="size-4 mr-2" />
              Hard delete (test user)
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <SoftDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        userId={userId}
        userType={userType}
        expectedEmail={email}
        onDone={onDone}
      />

      <AlertDialog open={confirmHardDelete} onOpenChange={setConfirmHardDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete this test user?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the auth user and their profile rows. The email address will be freed up
              for reuse. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={async () => {
                try {
                  await hardDeleteFn({ data: { userId } });
                  toast.success("Test user permanently deleted");
                  setConfirmHardDelete(false);
                  onDone();
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              Hard delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SoftDeleteDialog({
  open,
  onOpenChange,
  userId,
  userType,
  expectedEmail,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  userId: string;
  userType: string;
  expectedEmail: string;
  onDone: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const fn = useServerFn(adminSoftDeleteUser);
  const m = useMutation({
    mutationFn: () =>
      fn({
        data: {
          userId,
          confirmEmail: typed.trim(),
          reason: reason.trim() || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("User soft-deleted");
      setTyped("");
      setReason("");
      onOpenChange(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Soft-delete this {userType}?</AlertDialogTitle>
          <AlertDialogDescription>
            The user will be banned from signing in and hidden from default views. Their data is
            preserved. Type the user&apos;s email to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 py-2">
          <Input
            placeholder={expectedEmail}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <Input
            placeholder="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={typed.trim().toLowerCase() !== expectedEmail.toLowerCase() || m.isPending}
            onClick={() => m.mutate()}
            className="bg-destructive text-destructive-foreground"
          >
            Soft delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type ActiveUser = ReturnType<typeof rowsShape>;

function rowsShape() {
  // Placeholder to derive the row type from listAllUsers.
  return null as unknown as {
    userId: string;
    email: string | null;
    name: string;
    userType: string;
    isOrgAdmin: boolean;
    organizationId: string | null;
    organizationName: string | null;
    appliedCodes: Array<{
      id: string;
      code: string;
      scope: "next_checkout" | "active_now";
      environment: string | null;
    }>;
  };
}

function ManageUserSheet({
  user,
  onOpenChange,
  onDone,
}: {
  user: NonNullable<ActiveUser>;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const setOrgFn = useServerFn(adminSetUserOrg);
  const setOrgAdminFn = useServerFn(adminSetOrgAdmin);
  const applyFn = useServerFn(adminApplyPromoCode);
  const removeFn = useServerFn(adminRemovePromoCode);
  const codesFn = useServerFn(listActivePromoCodes);
  const qc = useQueryClient();

  const codes = useQuery({
    queryKey: ["admin-promo-code-picker"],
    queryFn: () => codesFn(),
  });

  const [selectedCode, setSelectedCode] = useState("");
  const [scope, setScope] = useState<"next_checkout" | "active_now">("next_checkout");
  const [environment, setEnvironment] = useState<"sandbox" | "live">("sandbox");

  const setOrg = useMutation({
    mutationFn: (org: OrgOption | null) =>
      setOrgFn({
        data: {
          userId: user.userId,
          organizationId: org?.id ?? null,
        },
      }),
    onSuccess: () => {
      toast.success("Organization updated");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setOrgAdmin = useMutation({
    mutationFn: (next: boolean) =>
      setOrgAdminFn({ data: { userId: user.userId, isOrgAdmin: next } }),
    onSuccess: () => {
      toast.success("Updated");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const apply = useMutation({
    mutationFn: () =>
      applyFn({
        data: {
          userId: user.userId,
          code: selectedCode,
          scope,
          environment: scope === "active_now" ? environment : undefined,
        },
      }),
    onSuccess: (res) => {
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Promo code applied");
      setSelectedCode("");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: (res) => {
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Promo code removed");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const currentOrg: OrgOption | null = user.organizationId
    ? {
        id: user.organizationId,
        name: user.organizationName ?? "(unnamed)",
        city: null,
        region: null,
        logoUrl: null,
      }
    : null;

  const isCoach = user.userType === "coach";

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{user.name}</SheetTitle>
          <SheetDescription>{user.email ?? "no email"}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-8">
          {/* Organization */}
          {isCoach && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-text-primary">Organization</h3>
              <OrgSearchCombobox
                selected={currentOrg}
                onSelect={(o) => setOrg.mutate(o)}
                onNotListed={() => setOrg.mutate(null)}
              />
              {currentOrg && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setOrg.mutate(null)}
                  disabled={setOrg.isPending}
                >
                  Unlink organization
                </Button>
              )}
              <ToggleRow
                id="org-admin-toggle"
                label="Organization admin"
                checked={user.isOrgAdmin}
                onCheckedChange={(v) => setOrgAdmin.mutate(v)}
              />
            </section>
          )}

          {/* Promo codes */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-text-primary">Promo codes</h3>

            {user.appliedCodes.length === 0 ? (
              <p className="text-xs text-text-tertiary">No admin-applied codes.</p>
            ) : (
              <ul className="space-y-2">
                {user.appliedCodes.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded-md border border-divider px-3 py-2"
                  >
                    <div>
                      <p className="font-mono text-sm">{c.code}</p>
                      <p className="text-xs text-text-tertiary">
                        {c.scope === "active_now"
                          ? `Active now (${c.environment})`
                          : "Next checkout"}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove.mutate(c.id)}
                      disabled={remove.isPending}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="rounded-md border border-divider p-3 space-y-3">
              <p className="text-xs uppercase tracking-wide text-text-tertiary">Apply a code</p>
              <Select value={selectedCode} onValueChange={setSelectedCode}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a code" />
                </SelectTrigger>
                <SelectContent>
                  {(codes.data?.codes ?? []).map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code} — {c.label ?? `${c.percent_off}% off`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex gap-2">
                <Chip
                  as="button"
                  size="micro"
                  selected={scope === "next_checkout"}
                  onClick={() => setScope("next_checkout")}
                >
                  Next checkout
                </Chip>
                <Chip
                  as="button"
                  size="micro"
                  selected={scope === "active_now"}
                  onClick={() => setScope("active_now")}
                  disabled={!isCoach}
                >
                  Apply to active subscription
                </Chip>
              </div>

              {scope === "active_now" && (
                <Select
                  value={environment}
                  onValueChange={(v) => setEnvironment(v as "sandbox" | "live")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sandbox">Test (sandbox)</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                  </SelectContent>
                </Select>
              )}

              <Button
                className="w-full"
                onClick={() => apply.mutate()}
                disabled={!selectedCode || apply.isPending}
              >
                {scope === "next_checkout"
                  ? "Stash for next checkout"
                  : "Apply to active subscription now"}
              </Button>
              <p className="text-[11px] text-text-tertiary">
                Next-checkout codes are used on the user&apos;s next Stripe checkout. Active-now
                attaches the coupon to their current Stripe subscription immediately.
              </p>
            </div>
          </section>
        </div>

        <SheetFooter className="mt-8">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
