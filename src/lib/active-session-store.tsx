import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "gradus.activeSession.v1";

export type ActiveSessionRole = "parent" | "athlete";

export type ActiveSession = {
  planId: string;
  role: ActiveSessionRole;
  planTitle: string;
  coachFirstName: string;
  athleteFirstName: string;
  /** ms since epoch when the current run resumed; null when paused. */
  startedAt: number | null;
  /** ms of elapsed time accumulated before the current run. */
  accumulatedMs: number;
};

type StartArgs = Omit<ActiveSession, "startedAt" | "accumulatedMs">;

type Ctx = {
  session: ActiveSession | null;
  start: (args: StartArgs) => boolean;
  pause: () => void;
  resume: () => void;
  clear: () => void;
  /** Compute current elapsed ms from session at call time. */
  getElapsedMs: () => number;
};

const ActiveSessionContext = createContext<Ctx | null>(null);

function readStorage(): ActiveSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveSession;
    if (!parsed || typeof parsed.planId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStorage(s: ActiveSession | null) {
  if (typeof window === "undefined") return;
  try {
    if (s) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function elapsedMsOf(s: ActiveSession | null): number {
  if (!s) return 0;
  if (s.startedAt == null) return s.accumulatedMs;
  return s.accumulatedMs + Math.max(0, Date.now() - s.startedAt);
}

export function ActiveSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ActiveSession | null>(null);

  // Hydrate from localStorage on mount (client only).
  useEffect(() => {
    setSession(readStorage());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setSession(readStorage());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((next: ActiveSession | null) => {
    setSession(next);
    writeStorage(next);
  }, []);

  const start = useCallback<Ctx["start"]>(
    (args) => {
      const current = readStorage();
      if (current && current.planId !== args.planId) return false;
      update({ ...args, startedAt: Date.now(), accumulatedMs: current?.accumulatedMs ?? 0 });
      return true;
    },
    [update],
  );

  const pause = useCallback(() => {
    setSession((cur) => {
      if (!cur || cur.startedAt == null) return cur;
      const next: ActiveSession = {
        ...cur,
        accumulatedMs: cur.accumulatedMs + Math.max(0, Date.now() - cur.startedAt),
        startedAt: null,
      };
      writeStorage(next);
      return next;
    });
  }, []);

  const resume = useCallback(() => {
    setSession((cur) => {
      if (!cur || cur.startedAt != null) return cur;
      const next: ActiveSession = { ...cur, startedAt: Date.now() };
      writeStorage(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => update(null), [update]);

  const getElapsedMs = useCallback(() => elapsedMsOf(session), [session]);

  const value = useMemo<Ctx>(
    () => ({ session, start, pause, resume, clear, getElapsedMs }),
    [session, start, pause, resume, clear, getElapsedMs],
  );

  return (
    <ActiveSessionContext.Provider value={value}>
      {children}
    </ActiveSessionContext.Provider>
  );
}

export function useActiveSession(): Ctx {
  const ctx = useContext(ActiveSessionContext);
  if (!ctx) throw new Error("useActiveSession must be used inside ActiveSessionProvider");
  return ctx;
}

/** Re-renders every `intervalMs` while the session is running. Returns live elapsed ms. */
export function useLiveElapsedMs(intervalMs = 1000): number {
  const { session } = useActiveSession();
  const [, force] = useState(0);
  const running = !!session && session.startedAt != null;
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => force((n) => n + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [running, intervalMs]);
  // Suppress unused-var lint
  void rafRef;
  return elapsedMsOf(session);
}
