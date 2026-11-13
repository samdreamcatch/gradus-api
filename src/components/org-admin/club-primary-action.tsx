import type { ComponentProps } from "react";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shared "+ Add …" call to action used in Users tab summary rows. */
export function ClubPrimaryAction({
  label,
  to,
  search,
  onClick,
  disabled,
}: {
  label: string;
  to?: ComponentProps<typeof Link>["to"];
  search?: Record<string, unknown>;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const content = (
    <>
      <Plus className="size-4" /> {label}
    </>
  );
  if (to) {
    return (
      <Button asChild className="min-h-11 press">
        <Link to={to} search={search as never}>
          {content}
        </Link>
      </Button>
    );
  }
  return (
    <Button className="min-h-11 press" onClick={onClick} disabled={disabled}>
      {content}
    </Button>
  );
}
