import { useState } from "react";
import { CoachBottomNav } from "@/components/coach/bottom-nav";
import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { AthleteBottomNav } from "@/components/athlete/bottom-nav";
import { BoardAccountSheet } from "@/components/board/board-account-sheet";
import { useViewerRole } from "@/hooks/use-viewer-role";

/**
 * The app's bottom navigation, on the public Live Board. Signed-in viewers get
 * the real bar for their account type; everyone else gets the same bar greyed
 * out, where a tap opens the sign-in sheet instead of navigating.
 */
export function BoardBottomNav({ slug }: { slug: string }) {
  const { role, signedIn } = useViewerRole();
  const [askOpen, setAskOpen] = useState(false);

  if (signedIn) {
    if (role === "coach") return <CoachBottomNav />;
    if (role === "parent") return <ParentBottomNav />;
    if (role === "athlete") return <AthleteBottomNav />;
  }

  return (
    <>
      <ParentBottomNav disabled onDisabledTap={() => setAskOpen(true)} />
      <BoardAccountSheet
        redirect={`/board/${slug}`}
        hideTrigger
        open={askOpen}
        onOpenChange={setAskOpen}
      />
    </>
  );
}
