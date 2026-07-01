import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Shown when a coach tries to save a move with a name that already exists
 * in their library. Offers to rename (cancel) or overwrite the existing move.
 */
export function NameConflictDialog({
  open,
  attemptedName,
  existingName,
  busy,
  onOpenChange,
  onOverwrite,
}: {
  open: boolean;
  attemptedName: string;
  existingName: string;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onOverwrite: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            A move named &ldquo;{existingName}&rdquo; already exists
          </AlertDialogTitle>
          <AlertDialogDescription>
            You already have a move named &ldquo;{existingName}&rdquo; in your
            library. Two moves can&rsquo;t share a name. Either change the name
            of &ldquo;{attemptedName}&rdquo;, or overwrite the existing move
            with these details.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Change name</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              onOverwrite();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? "Overwriting…" : "Overwrite existing"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
