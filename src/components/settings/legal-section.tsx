import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, FileText, ShieldCheck } from "lucide-react";
import { SettingsGroup, SettingsList, SettingsButtonRow } from "@/components/settings/primitives";

/**
 * Legal documents, reachable from every role's settings page.
 *
 * These have to live inside the app rather than only on the marketing site:
 * App Review reads the policy from the signed-in build, and Play expects the
 * privacy policy to be reachable without leaving the app.
 */
export function LegalSection() {
  const navigate = useNavigate();
  const chevron = <ChevronRight className="size-4 shrink-0 text-text-tertiary" />;

  return (
    <SettingsGroup label="Legal">
      <SettingsList>
        <SettingsButtonRow
          icon={<ShieldCheck className="size-4 text-text-tertiary" />}
          label="Privacy Policy"
          
          onClick={() => void navigate({ to: "/privacy" })}
          trailing={chevron}
        />
        <SettingsButtonRow
          icon={<FileText className="size-4 text-text-tertiary" />}
          label="Terms of Service"
          onClick={() => void navigate({ to: "/terms" })}
          trailing={chevron}
        />
      </SettingsList>
    </SettingsGroup>
  );
}
