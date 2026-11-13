import { useState } from "react";
import { queryOptions, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getStaffClubContract, updateClubContract } from "@/lib/club-contract.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function ClubContractEditor({ organizationId }: { organizationId: string }) {
  const { data: contract } = useSuspenseQuery(
    queryOptions({
      queryKey: ["staff-club-contract", organizationId],
      queryFn: () => getStaffClubContract({ data: { organizationId } }),
    }),
  );
  const [values, setValues] = useState(contract);
  const [busy, setBusy] = useState(false);
  const save = useServerFn(updateClubContract);
  const qc = useQueryClient();
  if (!values) return null;
  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await save({
            data: {
              organizationId,
              coach_seats: values.coach_seats,
              admin_seats: values.admin_seats,
              contract_seat_rate_cents: values.contract_seat_rate_cents,
              contract_currency: values.contract_currency,
              storefront_share_bps: values.storefront_share_bps,
              storefront_enabled: values.storefront_enabled,
              contract_starts_on: values.contract_starts_on,
              contract_ends_on: values.contract_ends_on,
              contract_signed_on: values.contract_signed_on,
              contract_file_url: values.contract_file_url,
            },
          });
          await qc.invalidateQueries({ queryKey: ["staff-club-contract", organizationId] });
          await qc.invalidateQueries({ queryKey: ["club-contract"] });
          toast.success("Contract saved.");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not save contract.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {(
        [
          ["coach_seats", "Coach seats", 0, 10000],
          ["admin_seats", "Admin seats", 1, 1000],
          ["storefront_share_bps", "Club share (basis points)", 0, 10000],
        ] as const
      ).map(([key, label, min, max]) => (
        <div key={key} className="space-y-1.5">
          <Label htmlFor={`contract-${key}`}>{label}</Label>
          <Input
            id={`contract-${key}`}
            type="number"
            min={min}
            max={max}
            required
            value={values[key]}
            onChange={(event) => setValues({ ...values, [key]: Number(event.target.value) })}
          />
        </div>
      ))}
      {(
        [
          ["contract_starts_on", "Term starts"],
          ["contract_ends_on", "Term ends"],
          ["contract_signed_on", "Signed"],
        ] as const
      ).map(([key, label]) => (
        <div key={key} className="space-y-1.5">
          <Label htmlFor={key}>{label}</Label>
          <Input
            id={key}
            type="date"
            value={values[key] ?? ""}
            onChange={(event) => setValues({ ...values, [key]: event.target.value || null })}
          />
        </div>
      ))}
      <div className="space-y-1.5">
        <Label htmlFor="seat-term-rate">Per-coach price for the full contract term</Label>
        <Input id="seat-term-rate" type="number" min="0" step="0.01" value={values.contract_seat_rate_cents == null ? "" : values.contract_seat_rate_cents / 100} onChange={(event) => setValues({ ...values, contract_seat_rate_cents: event.target.value ? Math.round(Number(event.target.value) * 100) : null })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contract-currency">Currency</Label>
        <Input id="contract-currency" maxLength={3} value={values.contract_currency} onChange={(event) => setValues({ ...values, contract_currency: event.target.value.toLowerCase() })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contract-file">Agreement URL</Label>
        <Input
          id="contract-file"
          type="url"
          value={values.contract_file_url ?? ""}
          onChange={(event) =>
            setValues({ ...values, contract_file_url: event.target.value || null })
          }
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="contract-storefront">Storefront enabled</Label>
        <Switch
          id="contract-storefront"
          checked={values.storefront_enabled}
          onCheckedChange={(checked) => setValues({ ...values, storefront_enabled: checked })}
        />
      </div>
      <Button className="min-h-11" disabled={busy} type="submit">
        {busy ? "Saving…" : "Save contract"}
      </Button>
    </form>
  );
}
