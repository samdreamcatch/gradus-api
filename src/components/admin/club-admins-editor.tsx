import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminAddClubAdmin, adminListClubAdmins, adminRemoveClubAdmin } from "@/lib/admin.functions";

/** Staff-only: name the people who run a club's admin panel. */
export function ClubAdminsEditor({ organizationId }: { organizationId: string }) {
  const list = useServerFn(adminListClubAdmins);
  const add = useServerFn(adminAddClubAdmin);
  const remove = useServerFn(adminRemoveClubAdmin);
  const qc = useQueryClient();
  const key = ["staff-club-admins", organizationId];
  const q = useQuery({ queryKey: key, queryFn: () => list({ data: { organizationId } }) });
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await add({ data: { organizationId, email } });
      toast.success(r.invited ? "Invite sent. They're a club admin once they sign in." : "Added as club admin.");
      setEmail("");
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add that admin.");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(userId: string) {
    try {
      await remove({ data: { organizationId, userId } });
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove that admin.");
    }
  }

  return (
    <section className="space-y-3 border-t border-divider pt-6">
      <h3 className="font-display text-h3 text-text-primary">Club admins</h3>
      {q.isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : (q.data?.admins.length ?? 0) === 0 ? (
        <p className="text-sm text-text-secondary">No club admins yet. The first person you add becomes the owner.</p>
      ) : (
        <ul className="divide-y divide-divider rounded-md border border-divider">
          {q.data!.admins.map((a) => (
            <li key={a.userId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="truncate text-text-primary">{a.email ?? a.userId}</span>
              <Button variant="ghost" size="sm" onClick={() => onRemove(a.userId)}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onSubmit} className="space-y-2">
        <Label htmlFor="club-admin-email">Add club admin by email</Label>
        <div className="flex gap-2">
          <Input id="club-admin-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="director@club.org" />
          <Button type="submit" disabled={busy || !email.trim()}>Add</Button>
        </div>
        <p className="text-xs text-text-tertiary">New addresses get the standard Gradus account invite.</p>
      </form>
    </section>
  );
}
