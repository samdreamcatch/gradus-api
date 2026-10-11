import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { draftMove } from "@/lib/moves.functions";

const UNAVAILABLE = "AI drafting isn't available right now.";

export type MoveDraftRequest = {
  name: string;
  sport: string;
  category?: string;
  /** The coach's few words, after an "unsure" or "unknown". */
  hint?: string;
  existing?: { description?: string; cue?: string; why?: string };
};

/** One AI draft per call (PRD decision #53); failures toast the server's friendly copy. */
export function useMoveDraft() {
  const draftFn = useServerFn(draftMove);
  return useMutation({
    mutationFn: (input: MoveDraftRequest) => draftFn({ data: input }),
    onError: (e: Error) => toast.error(e.message || UNAVAILABLE),
  });
}
