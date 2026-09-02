import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { readBoardReturn } from "@/lib/board-follow-store";

/**
 * Escape hatch on the auth screens: if the visitor came here from a Live Board,
 * offer a one-tap way back. Renders nothing otherwise. Read after hydration so
 * server and client markup match.
 */
export function BoardReturnLink({ className }: { className?: string }) {
  const [path, setPath] = useState<string | null>(null);

  useEffect(() => {
    setPath(readBoardReturn());
  }, []);

  if (!path) return null;

  return (
    <div className={className ?? "mb-4"}>
      <Chip as="a" href={path} size="caption" tone="muted" className="press inline-flex items-center gap-1">
        <ChevronLeft className="h-3 w-3" aria-hidden />
        Back to the Live Board
      </Chip>
    </div>
  );
}
