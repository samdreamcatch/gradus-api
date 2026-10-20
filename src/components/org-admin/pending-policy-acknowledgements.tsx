import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { listMyPendingAcknowledgements, getClubResourceUrl, acknowledgeResource } from "@/lib/org-content.functions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { openExternal } from "@/lib/native";
import { cn } from "@/lib/utils";

export function PendingPolicyAcknowledgements() {
  const list = useServerFn(listMyPendingAcknowledgements);
  const open = useServerFn(getClubResourceUrl);
  const sign = useServerFn(acknowledgeResource);
  const qc = useQueryClient();
  const mobile = useIsMobile();
  const pending = useQuery({ queryKey: ["pending-policy-acks"], queryFn: () => list() });
  const [show, setShow] = useState(false);
  const [opened, setOpened] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const key = (p: NonNullable<typeof pending.data>["pending"][number]) => `${p.organizationId}:${p.resourceId}:${p.version}:${p.forAthleteId ?? "self"}`;
  const acknowledge = useMutation({
    mutationFn: (p: NonNullable<typeof pending.data>["pending"][number]) => sign({ data: {
      resourceId: p.resourceId, organizationId: p.organizationId, version: p.version, forAthleteId: p.forAthleteId,
    } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pending-policy-acks"] }); toast.success("Acknowledged"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const items = pending.data?.pending ?? [];
  if (!items.length) return null;
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider bg-card px-4 py-3">
      <span className="text-sm text-text-primary">{items.length} club document{items.length === 1 ? "" : "s"} to acknowledge</span>
      <Button variant="outline" size="sm" className="press" onClick={() => setShow(true)}>Review</Button>
    </div>
    <Sheet open={show} onOpenChange={setShow}>
      <SheetContent side={mobile ? "bottom" : "right"} className={cn("w-full overflow-y-auto sm:max-w-lg", mobile ? "paper-surface max-h-[85dvh]" : "bg-popover")}>
        <SheetHeader><SheetTitle>Club documents</SheetTitle></SheetHeader>
        <div className="mt-5 divide-y divide-divider">
          {items.map((p) => <section key={key(p)} className="space-y-3 py-4">
            <p className="text-xs text-text-secondary">{p.orgName} · v{p.version}</p>
            <h3 className="font-display text-h3">{p.title}</h3>
            {p.forAthleteName && <p className="text-sm text-text-secondary">For {p.forAthleteName}</p>}
            <Button variant="outline" size="sm" onClick={async () => {
              try { const { url } = await open({ data: { resourceId: p.resourceId } }); await openExternal(url); setOpened((v) => [...v, key(p)]); }
              catch (e) { toast.error(e instanceof Error ? e.message : "Could not open document"); }
            }}><ExternalLink className="size-4" /> Open document</Button>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={confirmed.includes(key(p))} disabled={!opened.includes(key(p))} onCheckedChange={(checked) => setConfirmed((v) => checked ? [...v, key(p)] : v.filter((k) => k !== key(p)))} />
              I have read and acknowledge this document{p.forAthleteName ? ` on behalf of ${p.forAthleteName}` : ""}.
            </label>
            <Button size="sm" disabled={!confirmed.includes(key(p)) || acknowledge.isPending} onClick={() => acknowledge.mutate(p)}>Acknowledge</Button>
          </section>)}
        </div>
      </SheetContent>
    </Sheet>
  </>;
}