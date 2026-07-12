// Public + admin server functions for error tracking.
//
// reportClientError is intentionally PUBLIC (no auth middleware) so that
// errors on unauthenticated pages, including auth/signup pages, can still
// report. The handler reads the bearer token best-effort to attribute the
// error to a user when one is signed in.

import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'
import { dbError } from './db-error'

async function assertAdmin(context: { userId: string; supabase: any }) {
  const { data, error } = await context.supabase.rpc('has_role', {
    _user_id: context.userId,
    _role: 'admin',
  })
  if (error) dbError(error)
  if (!data) throw new Error('Forbidden')
}

/**
 * Normalize an error message so semantically-identical errors collapse into
 * one group: strip UUIDs, hex ids, decimals, URLs, quoted strings, and
 * whitespace. Keep it deterministic so hashing yields a stable signature.
 */
function normalizeErrorMessage(msg: string): string {
  return msg
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/"[^"]{1,120}"/g, '"<str>"')
    .replace(/'[^']{1,120}'/g, "'<str>'")
    .replace(/\b\d+(?:\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

function signatureFor(source: string, normalized: string): string {
  return createHash('sha256').update(`${source}::${normalized}`).digest('hex').slice(0, 32)
}


const reportInput = z.object({
  message: z.string().min(1).max(4000),
  stack: z.string().max(16000).optional().nullable(),
  route: z.string().max(1000).optional().nullable(),
  userAgent: z.string().max(1000).optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
})

export const reportClientError = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => reportInput.parse(input))
  .handler(async ({ data }) => {
    // Best-effort: resolve the user from the Authorization header if present.
    let userId: string | null = null
    try {
      const auth = getRequestHeader('authorization')
      if (auth?.startsWith('Bearer ')) {
        const token = auth.slice('Bearer '.length)
        const { createClient } = await import('@supabase/supabase-js')
        const supabaseUrl =
          process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL
        const publishable =
          process.env.SUPABASE_PUBLISHABLE_KEY ??
          import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
        if (supabaseUrl && publishable) {
          const client = createClient(supabaseUrl, publishable, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
          })
          const { data: u } = await client.auth.getUser()
          userId = u?.user?.id ?? null
        }
      }
    } catch {
      // best-effort only
    }

    const { logError } = await import('./error-tracking.server')
    await logError({
      source: 'client',
      message: data.message,
      stack: data.stack ?? null,
      route: data.route ?? null,
      userId,
      userAgent: data.userAgent ?? null,
      metadata: data.metadata,
    })
    return { ok: true }
  })

export const listAdminErrors = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        limit: z.number().int().min(1).max(500).optional().default(200),
        includeTest: z.boolean().optional().default(false),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context)
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server')

    const { data: rows, error } = await supabaseAdmin
      .from('client_errors')
      .select('id,source,message,route,user_id,user_email,user_role,user_name,created_at')
      .order('created_at', { ascending: false })
      .limit(data.limit)
    if (error) dbError(error)

    if (data.includeTest || !rows?.length) {
      return { items: rows ?? [] }
    }

    // Filter test users (best-effort) by looking up is_test flags.
    const userIds = Array.from(
      new Set(rows.map((r: any) => r.user_id).filter(Boolean)),
    ) as string[]
    if (!userIds.length) return { items: rows }

    const [coaches, parents] = await Promise.all([
      supabaseAdmin
        .from('coach_profiles')
        .select('user_id')
        .in('user_id', userIds)
        .eq('is_test', true),
      supabaseAdmin
        .from('parent_profiles')
        .select('user_id')
        .in('user_id', userIds)
        .eq('is_test', true),
    ])
    const testIds = new Set<string>([
      ...((coaches.data ?? []).map((r: any) => r.user_id)),
      ...((parents.data ?? []).map((r: any) => r.user_id)),
    ])

    return {
      items: rows.filter((r: any) => !r.user_id || !testIds.has(r.user_id)),
    }
  })

export const getAdminError = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context)
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
    const { data: row, error } = await supabaseAdmin
      .from('client_errors')
      .select('*')
      .eq('id', data.id)
      .maybeSingle()
    if (error) dbError(error)
    return { error: row }
  })
