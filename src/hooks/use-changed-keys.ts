import { useEffect, useRef, useState } from "react";

/**
 * Track which keys changed between renders and keep them "hot" briefly, so a
 * row can flash when its state moves — the way a flight board flips.
 *
 * `signature` maps a key to a string that changes whenever that row changes.
 */
export function useChangedKeys(signature: Record<string, string>, holdMs = 6_000): Set<string> {
  const previous = useRef<Record<string, string> | null>(null);
  const [changed, setChanged] = useState<Set<string>>(new Set());

  useEffect(() => {
    const prev = previous.current;
    previous.current = signature;
    if (!prev) return;

    const hits = Object.keys(signature).filter((k) => k in prev && prev[k] !== signature[k]);
    if (hits.length === 0) return;

    setChanged((old) => new Set([...old, ...hits]));
    const timer = setTimeout(() => {
      setChanged((old) => {
        const next = new Set(old);
        for (const k of hits) next.delete(k);
        return next;
      });
    }, holdMs);
    return () => clearTimeout(timer);
    // Compare by value: the object identity changes on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(signature), holdMs]);

  return changed;
}
