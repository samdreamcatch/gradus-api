/**
 * Device-local registry of the competitions and skaters a viewer follows.
 * The board page owns the writes (it has done so since the board shipped);
 * this module only reads the same keys so other parts of the app — notably
 * the signed-in "your skaters" banner — can react to them.
 */

const HISTORY_KEY = "gradus.boardHistory";
const FOLLOW_KEY = "gradus.boardFollow";
const EXTRA_KEY = "gradus.boardFollowExtra";
const DISMISS_KEY = "gradus.boardBannerDismissed";
const RETURN_KEY = "gradus.boardReturn";

/**
 * The board path a signed-out visitor left to visit an auth screen, so those
 * screens can offer a way back. Session-scoped: it never lingers into a later
 * visit, and it survives the Google OAuth round trip (unlike a URL param).
 */
export function writeBoardReturn(path: string) {
  if (typeof window === "undefined") return;
  if (!path.startsWith("/board/")) return;
  try {
    window.sessionStorage.setItem(RETURN_KEY, path);
  } catch {
    // Convenience only; storage failures are silent.
  }
}

export function readBoardReturn(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RETURN_KEY);
    return raw && raw.startsWith("/board/") ? raw : null;
  } catch {
    return null;
  }
}

export function clearBoardReturn() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // no-op
  }
}

export interface BoardHistoryEntry {
  slug: string;
  name: string;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Most recently visited boards, newest first. */
export function readBoardHistory(): BoardHistoryEntry[] {
  const list = readJson<BoardHistoryEntry[]>(HISTORY_KEY, []);
  return Array.isArray(list) ? list.filter((e) => e && typeof e.slug === "string") : [];
}

/** Skaters the viewer added by hand on this device for a competition. */
export function readExtraFollows(slug: string): string[] {
  const list = readJson<string[]>(`${EXTRA_KEY}.${slug}`, []);
  return Array.isArray(list) ? list : [];
}

/** Normalized names the viewer has muted for a competition. */
export function readUnfollowed(slug: string): string[] {
  const list = readJson<string[]>(`${FOLLOW_KEY}.${slug}`, []);
  return Array.isArray(list) ? list : [];
}

export function isBannerDismissed(slug: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(`${DISMISS_KEY}.${slug}`) === "1";
  } catch {
    return false;
  }
}

export function dismissBanner(slug: string) {
  try {
    window.localStorage.setItem(`${DISMISS_KEY}.${slug}`, "1");
  } catch {
    // Dismissal is a convenience; storage failures are silent.
  }
}
