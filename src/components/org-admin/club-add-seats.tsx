import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { type ClubContract, expandClubContract } from "@/lib/club-contract.functions";
import { proratedSeatCost } from "@/lib/club-contract-quote";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ClubKeyValueTable } from "./club-key-value-table";

export function ClubAddSeats({ club }: { club: ClubContract }) {
  const expand = useServerFn(expandClubContract);
  const qc = useQueryClient();
  const mobile = useIsMobile();
  const [expansion, setExpansion] = useState(false);
  const [extraSeats, setExtraSeats] = useState(1);
  const [expansionKey, setExpansionKey] = useState("");
  const [busy, setBusy] = useState(false);
  const quote =
    club.contract_seat_rate_cents == null || !club.contract_starts_on || !club.contract_ends_on
      ? null
      : proratedSeatCost(
          club.contract_seat_rate_cents,
          extraSeats,
          club.contract_starts_on,
          club.contract_ends_on,
          new Date().toISOString().slice(0, 10),
        );
  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["club-capacity", club.id] }),
        qc.invalidateQueries({ queryKey: ["club-contract"] }),
        qc.invalidateQueries({ queryKey: ["club-seat-requests", club.id] }),
        qc.invalidateQueries({ queryKey: ["org-people"] }),
      ]);
      toast.success(done);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        className="h-11 font-sans"
        onClick={() => {
          setExpansion(true);
          setExpansionKey(crypto.randomUUID());
        }}
      >
        Add seats
      </Button>
      <Sheet open={expansion} onOpenChange={setExpansion}>
        <SheetContent
          side={mobile ? "bottom" : "right"}
          className={mobile ? "paper-surface p-6" : "p-6"}
        >
          <SheetHeader>
            <SheetTitle>Add contract seats</SheetTitle>
            <SheetDescription>
              Additional seats take effect immediately. The remaining contract term is billed at
              your agreed rate.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <Label htmlFor="extra-seats">Additional coach seats</Label>
            <Input
              id="extra-seats"
              type="number"
              min={1}
              max={1000}
              value={extraSeats}
              onChange={(e) => setExtraSeats(Number(e.target.value))}
            />
            {quote == null ? (
              <p className="text-sm text-text-secondary">
                Gradus must set your contract rate and active term before seats can be added.
              </p>
            ) : (
              <ClubKeyValueTable
                rows={[
                  [
                    "True-up balance",
                    new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: club.contract_currency,
                    }).format(quote / 100),
                  ],
                  ["Term ends", displayDate(club.contract_ends_on)],
                  ["Seats after increase", club.coach_seats + extraSeats],
                ]}
              />
            )}
            <Button
              disabled={busy || quote == null}
              className="h-11"
              onClick={async () => {
                if (quote == null) return;
                const ok = await run(
                  () =>
                    expand({
                      data: {
                        organizationId: club.id,
                        seats: extraSeats,
                        expectedAmount: quote,
                        requestKey: expansionKey,
                      },
                    }),
                  "Seats added. True-up balance recorded for invoicing.",
                );
                if (ok) setExpansion(false);
              }}
            >
              Confirm seat increase
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function displayDate(value: string | null) {
  if (!value) return "—";
  return new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
