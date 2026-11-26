import { createFileRoute } from "@tanstack/react-router";
import { Store } from "lucide-react";
import { ClubPageHeader } from "@/components/org-admin/club-page-header";

export const Route = createFileRoute("/_authenticated/org-admin/storefront")({
  head: () => ({
    meta: [
      { title: "Storefront · Gradus Club" },
      { name: "description", content: "Sell club programs and merchandise. Coming soon." },
      { property: "og:title", content: "Storefront · Gradus Club" },
      { property: "og:description", content: "Sell club programs and merchandise. Coming soon." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StorefrontPage,
});

function StorefrontPage() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <ClubPageHeader title="Storefront" />
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-divider bg-card px-6 py-16 text-center">
        <Store className="size-8 text-text-tertiary" aria-hidden="true" />
        <h2 className="font-display text-h3">Coming soon</h2>
        <p className="max-w-md text-text-secondary">
          Your club's storefront will live here.
        </p>
      </div>
    </div>
  );
}
