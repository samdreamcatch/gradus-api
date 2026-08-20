import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { reportError } from "@/lib/client-error-reporter";

/**
 * Error boundary body for the plans routes.
 *
 * Route `errorComponent`s don't trigger window.onerror, so failures here were
 * invisible in the admin error table. Reporting explicitly closes that gap.
 */
export function PlansRouteError({
  error,
  label,
  backTo,
}: {
  error: Error;
  label: string;
  backTo?: "/athlete/plans" | "/parent/plans";
}) {
  useEffect(() => {
    reportError(error, { metadata: { type: "route.errorComponent", boundary: label } });
  }, [error, label]);

  return (
    <div className="mx-auto max-w-2xl px-3 py-8">
      {backTo ? (
        <Link
          to={backTo}
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="size-4" /> Back
        </Link>
      ) : null}
      <div className="mt-6 rounded-2xl border border-divider bg-card p-6 text-sm text-text-secondary">
        {label}: {error.message}
      </div>
    </div>
  );
}
