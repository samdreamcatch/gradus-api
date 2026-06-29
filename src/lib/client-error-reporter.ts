// Browser-side global error reporter.
// Wires window.onerror + unhandledrejection and posts to the
// public reportClientError server function via sendBeacon.
//
// Deliberately dumb and defensive:
//   - skipped in dev (import.meta.env.DEV)
//   - 50-report session cap, prevents runaway loops from spamming alerts
//   - wrapped in try/catch so the reporter itself can never throw
//   - sendBeacon falls back to fetch keepalive

import { supabase } from '@/integrations/supabase/client'

const SESSION_CAP = 50
let reportCount = 0
let installed = false

function fmtError(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) {
    return { message: value.message || value.name, stack: value.stack }
  }
  if (typeof value === 'string') return { message: value }
  try {
    return { message: JSON.stringify(value) ?? String(value) }
  } catch {
    return { message: String(value) }
  }
}

async function send(payload: {
  message: string
  stack?: string | null
  route?: string | null
  userAgent?: string | null
  metadata?: Record<string, unknown>
}) {
  if (reportCount >= SESSION_CAP) return
  reportCount += 1
  try {
    // Attach bearer token via fetch keepalive so the server can attribute
    // the error to the signed-in user. sendBeacon can't set headers.
    let authHeader: Record<string, string> = {}
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (token) authHeader = { Authorization: `Bearer ${token}` }
    } catch {
      // ignore
    }

    await fetch('/_serverFn/reportClientError', {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json', ...authHeader },
      body: JSON.stringify({ data: payload }),
    }).catch(() => {})
  } catch {
    // never throw from the reporter
  }
}

export function reportError(
  error: unknown,
  extra: { route?: string | null; metadata?: Record<string, unknown> } = {},
) {
  try {
    const { message, stack } = fmtError(error)
    void send({
      message,
      stack: stack ?? null,
      route: extra.route ?? (typeof window !== 'undefined' ? window.location.pathname : null),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      metadata: extra.metadata,
    })
  } catch {
    // swallow
  }
}

export function installErrorReporter() {
  if (installed) return
  if (typeof window === 'undefined') return
  if (import.meta.env.DEV) return
  installed = true

  window.addEventListener('error', (evt) => {
    reportError(evt.error ?? evt.message, {
      metadata: { type: 'window.error', filename: evt.filename, lineno: evt.lineno, colno: evt.colno },
    })
  })

  window.addEventListener('unhandledrejection', (evt) => {
    reportError(evt.reason, { metadata: { type: 'unhandledrejection' } })
  })
}
