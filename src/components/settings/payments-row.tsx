import { ChevronRight, Receipt } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { SettingsList, SettingsRow } from "@/components/settings/primitives";

/** One-row entry point into the payments sub-page (src/components/payments). */
export function PaymentsRow({
  to,
}: {
  to: "/coach/settings/payments" | "/parent/settings/payments" | "/athlete/settings/payments";
}) {
  const coach = to === "/coach/settings/payments";
  return (
    <SettingsList className="mt-3">
      <Link to={to} className="press-soft block">
        <SettingsRow
          icon={<Receipt className="size-4" />}
          label={coach ? "Payment history" : "Payments"}
          description={
            coach
              ? "Your Marketplace sales, what buyers still owe, and payouts."
              : "Plans you bought, payments due, and receipts."
          }
          trailing={<ChevronRight className="size-4 shrink-0 text-text-tertiary" />}
        />
      </Link>
    </SettingsList>
  );
}
