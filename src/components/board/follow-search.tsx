import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Input } from "@/components/ui/input";
import { allEvents } from "@/components/board/my-skaters";
import { normalizeName, type BoardPayload } from "@/lib/board-types";

interface Entry {
  name: string;
  key: string;
  where: string;
}

/** Every skater on the day's start orders, de-duplicated by name. */
function everySkater(payload: BoardPayload | null): Entry[] {
  if (!payload) return [];
  const byKey = new Map<string, Entry>();
  for (const event of allEvents(payload)) {
    for (const s of event.results) {
      const key = normalizeName(s.name);
      if (!key || byKey.has(key)) continue;
      byKey.set(key, {
        name: s.name,
        key,
        where: [event.name, event.rink].filter(Boolean).join(" · "),
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Follow anyone skating today — a rinkmate, a training partner, a rival — with
 * no account and no connection. Followed names live on this device only.
 */
export function FollowSearch({
  payload,
  followedKeys,
  onFollow,
  onUnfollow,
}: {
  payload: BoardPayload | null;
  /** Normalized names currently followed by hand. */
  followedKeys: string[];
  onFollow: (name: string) => void;
  onUnfollow: (key: string) => void;
}) {
  const [query, setQuery] = useState("");
  const entries = useMemo(() => everySkater(payload), [payload]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return entries.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 8);
  }, [entries, query]);

  if (entries.length === 0) return null;

  const followed = entries.filter((e) => followedKeys.includes(e.key));

  return (
    <Card variant="section" className="space-y-3">
      <Eyebrow as="h2" size="micro" tone="tertiary">
        FOLLOW A SKATER
      </Eyebrow>

      <label htmlFor="board-follow-search" className="sr-only">
        Search skaters competing today
      </label>
      <Input
        id="board-follow-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a skater's name"
        autoComplete="off"
      />

      {query.trim().length >= 2 ? (
        results.length > 0 ? (
          <ul className="divide-y divide-divider">
            {results.map((e) => {
              const isFollowed = followedKeys.includes(e.key);
              return (
                <li key={e.key} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text-primary">{e.name}</span>
                    <span className="block truncate font-mono text-nano text-text-tertiary">
                      {e.where}
                    </span>
                  </span>
                  <Chip
                    size="small"
                    className="min-h-11 shrink-0"
                    selected={isFollowed}
                    aria-pressed={isFollowed}
                    aria-label={isFollowed ? `Stop following ${e.name}` : `Follow ${e.name}`}
                    onClick={() => (isFollowed ? onUnfollow(e.key) : onFollow(e.name))}
                  >
                    {isFollowed ? "Following" : "Follow"}
                  </Chip>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-text-secondary">
            No skater by that name on today&apos;s start orders.
          </p>
        )
      ) : (
        <p className="text-sm text-text-secondary">
          Type a name to follow anyone skating today. Saved on this device — no account needed.
        </p>
      )}

      {followed.length > 0 ? (
        <p className="font-mono text-xs text-text-tertiary">
          following {followed.map((e) => e.name).join(", ")}
        </p>
      ) : null}
    </Card>
  );
}
