import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Eyebrow } from "@/components/ui/eyebrow";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { writeBoardReturn } from "@/lib/board-follow-store";

const ROLES = [
  { key: "parent", label: "I'm a parent", to: "/signup/parent" as const },
  { key: "coach", label: "I'm a coach", to: "/signup/coach" as const },
  { key: "athlete", label: "I'm an athlete", to: "/signup/athlete" as const },
];

/**
 * Board header affordance: a single chip that opens the sign-in / sign-up
 * paths. `redirect` is the board path we return to after signing in.
 */
export function BoardAccountSheet({
  redirect,
  label = "Sign in",
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  redirect: string;
  label?: string;
  /** Drive the sheet from outside (e.g. a tap on the greyed-out bottom nav). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  return (
    <>
      {hideTrigger ? null : (
        <Chip size="caption" onClick={() => setOpen(true)} className="press shrink-0">
          {label}
        </Chip>
      )}


      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="paper-surface max-h-[90dvh] overflow-y-auto">
          <SheetHeader className="text-left">
            <SheetTitle className="font-display text-h3 text-text-primary">
              Follow along with Gradus
            </SheetTitle>
            <SheetDescription>
              Sign in and the skaters you&apos;re connected to show up here automatically — plus
              live updates while you use the app.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            <Link
              to="/login"
              search={{ redirect }}
              onClick={() => {
                writeBoardReturn(redirect);
                setOpen(false);
              }}
              className="press block"
            >
              <Card variant="row" className="text-center">
                <p className="font-display text-base text-text-primary">Sign in</p>
              </Card>
            </Link>

            <div className="space-y-2">
              <Eyebrow size="caption" tone="tertiary">
                NEW TO GRADUS?
              </Eyebrow>
              {ROLES.map((r) => (
                <Link
                  key={r.key}
                  to={r.to}
                  onClick={() => {
                    writeBoardReturn(redirect);
                    setOpen(false);
                  }}
                  className="press block"
                >
                  <Card variant="row">
                    <p className="text-sm text-text-primary">{r.label}</p>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
