import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { adminLookupPurchases } from "@/lib/admin-marketplace.functions";
import { Input } from "@/components/ui/input";
import { AdminPageHeader } from "@/components/admin/marketplace-ui";
import { PurchaseList } from "@/components/admin/marketplace-purchases";

const searchSchema = z.object({
  q: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/admin/marketplace/purchases")({
  validateSearch: zodValidator(searchSchema),
  component: PurchaseLookup,
});

function PurchaseLookup() {
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (draft !== q) navigate({ search: (prev: any) => ({ ...prev, q: draft }), replace: true });
    }, 400);
    return () => window.clearTimeout(t);
  }, [draft, q, navigate]);

  const lookupFn = useServerFn(adminLookupPurchases);
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["admin-marketplace-purchases", q],
    queryFn: () => lookupFn({ data: { q } }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <AdminPageHeader
        eyebrow="Marketplace · Support"
        title="Purchases"
        subtitle="Look up a buyer's purchases by email or name, or paste a purchase, user, plan or Stripe id (cs_, pi_, tr_)."
        back={{ to: "/admin/marketplace", label: "Marketplace" }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Buyer email, name, or id"
          className="w-full max-w-md"
          aria-label="Search purchases"
          autoFocus
        />
      </AdminPageHeader>

      {isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive">
          Couldn't look up purchases. {error instanceof Error ? error.message : ""}
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-text-tertiary">
            {q.trim()
              ? `${data?.length ?? 0} purchase${data?.length === 1 ? "" : "s"} for “${q.trim()}”`
              : "Latest 50 purchases"}
            {isFetching ? " · updating…" : ""}
          </p>
          <PurchaseList
            rows={data ?? []}
            empty={q.trim() ? "No purchases match that buyer or id." : "No purchases yet."}
          />
        </div>
      )}
    </div>
  );
}
