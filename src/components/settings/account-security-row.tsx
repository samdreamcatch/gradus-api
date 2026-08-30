import { ChevronRight, ShieldCheck } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { SettingsList, SettingsRow } from "@/components/settings/primitives";

/**
 * One-row entry point into the Account & security sub-page. Rendered inside the
 * Plan group so it sits with Manage billing.
 */
export function AccountSecurityRow({
  to,
}: {
  to: "/coach/settings/account" | "/parent/settings/account" | "/athlete/settings/account";
}) {
  return (
    <SettingsList className="mt-3">
      <Link to={to} className="press-soft block">
        <SettingsRow
          icon={<ShieldCheck className="size-4" />}
          label="Account & security"
          description="Password, email, and deleting your account."
          trailing={<ChevronRight className="size-4 shrink-0 text-text-tertiary" />}
        />
      </Link>
    </SettingsList>
  );
}
