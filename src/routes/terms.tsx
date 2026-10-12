import { createFileRoute, redirect } from "@tanstack/react-router";
import { TERMS_OF_SERVICE_URL } from "@/lib/legal-urls";

/**
 * The Terms of Service are published once, on gradussports.com; this path
 * stays for the links already out in emails, the iOS app and sign-up pages.
 * When the wording changes there, bump CURRENT_TERMS_VERSION in src/lib/terms.ts.
 */
export const Route = createFileRoute("/terms")({
  beforeLoad: () => {
    throw redirect({ href: TERMS_OF_SERVICE_URL, reloadDocument: true });
  },
});
