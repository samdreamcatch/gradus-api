// Browser-side global error reporter.
// Wires window.onerror + unhandledrejection and posts to the
// public reportClientError server function.
//
// Deliberately dumb and defensive:
//   - skipped in dev (import.meta.env.DEV)
//   - skipped on non-production hosts (localhost, Lovable preview/sandbox
//     subdomains like *.lovable.dev and id-preview--*.lovable.app). Only the
//     canonical production hosts report — this avoids alert spam while we're
//     actively building in the Lovable editor.
//   - 50-report session cap, prevents runaway loops from spamming alerts
//   - wrapped in try/catch so the reporter itself can never throw

import { reportClientError } from "./error-tracking.functions";

const SESSION_CAP = 50;
const PRODUCTION_HOSTS = new Set(["gradus.training", "gradustraining.lovable.app"]);
let reportCount = 0;
let installed = false;

function isProductionHost(): boolean {
  if (typeof window === "undefined") return false;
  return PRODUCTION_HOSTS.has(window.location.hostname);
}

function fmtError(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) {
    return { message: value.message || value.name, stack: value.stack };
  }
  if (typeof value === "string") return { message: value };
  try {
    return { message: JSON.stringify(value) ?? String(value) };
  } catch {
    return { message: String(value) };
  }
}

// Benign browser warnings we deliberately don't report. These fire as
// window.onerror in some browsers but represent no user-visible failure.
const IGNORED_MESSAGE_PATTERNS: RegExp[] = [
  /ResizeObserver loop completed with undelivered notifications/i,
  /ResizeObserver loop limit exceeded/i,
];

function isIgnoredMessage(message: string): boolean {
  return IGNORED_MESSAGE_PATTERNS.some((re) => re.test(message));
}

function send(payload: {
  message: string;
  stack?: string | null;
  route?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}) {
  if (reportCount >= SESSION_CAP) return;
  reportCount += 1;
  try {
    void reportClientError({ data: payload }).catch(() => {});
  } catch {
    // never throw from the reporter
  }
}

export function reportError(
  error: unknown,
  extra: { route?: string | null; metadata?: Record<string, unknown> } = {},
) {
  if (import.meta.env.DEV) return;
  if (!isProductionHost()) return;
  try {
    const { message, stack } = fmtError(error);
    if (isIgnoredMessage(message)) return;
    send({
      message,
      stack: stack ?? null,
      route: extra.route ?? (typeof window !== "undefined" ? window.location.pathname : null),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      metadata: extra.metadata,
    });
  } catch {
    // swallow
  }
}

export function installErrorReporter() {
  if (installed) return;
  if (typeof window === "undefined") return;
  if (import.meta.env.DEV) return;
  if (!isProductionHost()) return;
  installed = true;

  window.addEventListener("error", (evt) => {
    reportError(evt.error ?? evt.message, {
      metadata: {
        type: "window.error",
        filename: evt.filename,
        lineno: evt.lineno,
        colno: evt.colno,
      },
    });
  });

  window.addEventListener("unhandledrejection", (evt) => {
    reportError(evt.reason, { metadata: { type: "unhandledrejection" } });
  });
}
