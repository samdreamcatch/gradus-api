// Server-only error logging helper.
// Inserts a row into client_errors. Per-error alert emails are DISABLED — an
// hourly digest job at /api/public/hooks/error-digest reads production errors
// and emails a single summary to admins.

import { createClient } from '@supabase/supabase-js'


export type ErrorLogInput = {
  source: 'client' | 'server'
  message: string
  stack?: string | null
  route?: string | null
  userId?: string | null
  userAgent?: string | null
  metadata?: Record<string, unknown>
  environment?: 'production' | 'preview'
}


type ResolvedUser = {
  userId: string | null
  userEmail: string | null
  userRole: string | null
  userName: string | null
  isTest: boolean
}

async function resolveUser(supabaseAdmin: any, userId: string | null): Promise<ResolvedUser> {
  if (!userId) {
    return { userId: null, userEmail: null, userRole: null, userName: null, isTest: false }
  }
  try {
    const { data: authData } = await supabaseAdmin.auth.admin.getUserById(userId)
    const email = authData?.user?.email ?? null

    // Try coach, parent, then athlete profile lookups in parallel
    const [coachRes, parentRes, athleteRes] = await Promise.all([
      supabaseAdmin.from('coach_profiles').select('first_name,last_name,is_test').eq('user_id', userId).maybeSingle(),
      supabaseAdmin.from('parent_profiles').select('first_name,last_name,is_test').eq('user_id', userId).maybeSingle(),
      supabaseAdmin.from('athletes').select('first_name,last_name').eq('user_id', userId).maybeSingle(),
    ])

    let name: string | null = null
    let role: string | null = null
    let isTest = false
    if (coachRes.data) {
      role = 'coach'
      name = [coachRes.data.first_name, coachRes.data.last_name].filter(Boolean).join(' ') || null
      isTest = coachRes.data.is_test === true
    } else if (parentRes.data) {
      role = 'parent'
      name = [parentRes.data.first_name, parentRes.data.last_name].filter(Boolean).join(' ') || null
      isTest = parentRes.data.is_test === true
    } else if (athleteRes.data) {
      role = 'athlete'
      name = [athleteRes.data.first_name, athleteRes.data.last_name].filter(Boolean).join(' ') || null
    }

    return { userId, userEmail: email, userRole: role, userName: name, isTest }
  } catch {
    return { userId, userEmail: null, userRole: null, userName: null, isTest: false }
  }
}

export async function logError(input: ErrorLogInput): Promise<{ id: string } | null> {
  const supabaseUrl = process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('[error-tracking] missing supabase env')
    return null
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const user = await resolveUser(supabaseAdmin, input.userId ?? null)
  if (user.isTest) {
    // Skip logging for known test users so real production signal isn't
    // diluted by staff/QA activity.
    return null
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('client_errors')
    .insert({
      source: input.source,
      message: input.message.slice(0, 4000),
      stack: input.stack?.slice(0, 16000) ?? null,
      route: input.route?.slice(0, 1000) ?? null,
      user_id: user.userId,
      user_email: user.userEmail,
      user_role: user.userRole,
      user_name: user.userName,
      user_agent: input.userAgent?.slice(0, 1000) ?? null,
      metadata: input.metadata ?? {},
      environment: input.environment ?? 'production',
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    console.error('[error-tracking] insert failed', insertError)
    return null
  }

  // Per-error alert emails are DISABLED. See
  // /api/public/hooks/error-digest for the hourly digest that replaces them.
  return { id: inserted.id }
}

