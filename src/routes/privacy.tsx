import { createFileRoute, redirect } from "@tanstack/react-router";
import { PRIVACY_POLICY_URL } from "@/lib/legal-urls";

/**
 * The Privacy Policy is published once, on gradussports.com; this path stays
 * for the links already out in emails, the iOS app and the direct notice.
 */
export const Route = createFileRoute("/privacy")({
  beforeLoad: () => {
    throw redirect({ href: PRIVACY_POLICY_URL, reloadDocument: true });
  },
});
