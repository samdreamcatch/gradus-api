import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

/** The web pages a checkout may come back to (`payMyPurchaseFn`); anything else goes to the app. */
const WEB_RETURNS = ["/parent/settings/payments", "/athlete/settings/payments"] as const;

const searchSchema = z.object({
  purchase: z.string().uuid().optional(),
  canceled: z.coerce.boolean().optional(),
  return: z.enum(WEB_RETURNS).optional().catch(undefined),
});

/**
 * Where Stripe Checkout sends a buyer (src/lib/plan-purchases.server.ts). From
 * the iOS app: straight back to the app (`gradus://marketplace/purchases/<id>`),
 * which then checks the purchase and opens the plan. Public: Safari has no
 * Gradus session. From the web payments page (`return`): back to that page,
 * which records the payment.
 */
export const Route = createFileRoute("/purchase/complete")({
  validateSearch: searchSchema,
  component: PurchaseCompletePage,
});

function PurchaseCompletePage() {
  const { purchase, canceled, return: webReturn } = Route.useSearch();
  const appUrl = webReturn
    ? `${webReturn}${purchase ? `?purchase=${purchase}${canceled ? "&canceled=1" : ""}` : ""}`
    : purchase
      ? `gradus://marketplace/purchases/${purchase}${canceled ? "?canceled=1" : ""}`
      : "gradus://marketplace";

  useEffect(() => {
    window.location.href = appUrl;
  }, [appUrl]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-12">
        <div>
          <Logo className="text-4xl" />
        </div>
        <section aria-labelledby="purchase-heading" className="flex flex-col gap-3">
          <h1 id="purchase-heading" className="text-2xl font-semibold">
            {canceled ? "Checkout canceled" : "Payment received"}
          </h1>
          <p>
            {canceled
              ? "You weren't charged. Go back to the Gradus app to keep browsing."
              : "Thanks! Go back to the Gradus app and the plan will be ready in your Plans."}
          </p>
          <Button asChild>
            <a href={appUrl}>Open Gradus</a>
          </Button>
        </section>
      </div>
    </main>
  );
}
