import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { PageTitle } from "@/components/page-title";

export function ClubPageHeader({
  title,
  actions,
  back,
}: {
  title: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
}) {
  return (
    <div className="space-y-3">
      {back && (
        <Link
          to={back.to as never}
          className="font-sans text-sm text-text-secondary underline underline-offset-4"
        >
          ‹ {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <PageTitle>{title}</PageTitle>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 font-sans">{actions}</div>}
      </div>
    </div>
  );
}
