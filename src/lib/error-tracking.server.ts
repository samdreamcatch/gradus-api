// Server-only error logging helper.
// Inserts a row into client_errors and enqueues an alert email
// to the configured admin recipients on every occurrence.
//
// MVP: no dedup, no grouping. One row + one email per occurrence.

import * as React from 'react'
import { render } from '@react-email/components'
import { createClient } from '@supabase/supabase-js'
import { ErrorAlertEmail } from './email-templates/error-alert'

const ALERT_RECIPIENTS = ['mariah@gradussports.com', 'alyson@gradussports.com']
const SITE_NAME = 'gradussportsapp'
const SENDER_DOMAIN = 'support.gradussports.com'
const FROM_DOMAIN = 'support.gradussports.com'
const ROOT_DOMAIN = 'gradus.training'

export type ErrorLogInput = {
  source: 'client' | 'server'
  message: string
  stack?: string | null
  route?: string | null
  userId?: string | null
  userAgent?: string | null
  metadata?: Record<string, unknown>
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
  const occurredAt = new Date().toISOString()

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
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    console.error('[error-tracking] insert failed', insertError)
    return null
  }

  // Fire-and-forget email send. Never let alert failure crash the request.
  void sendAlertEmail({
    errorId: inserted.id,
    message: input.message,
    stack: input.stack ?? null,
    route: input.route ?? null,
    source: input.source,
    userAgent: input.userAgent ?? null,
    occurredAt,
    user,
    supabaseAdmin,
  }).catch((err) => {
    console.error('[error-tracking] alert email failed', err)
  })

  return { id: inserted.id }
}

async function sendAlertEmail(params: {
  errorId: string
  message: string
  stack: string | null
  route: string | null
  source: 'client' | 'server'
  userAgent: string | null
  occurredAt: string
  user: ResolvedUser
  supabaseAdmin: any
}) {
  const element = React.createElement(ErrorAlertEmail, {
    message: params.message,
    stack: params.stack,
    route: params.route,
    source: params.source,
    userName: params.user.userName,
    userEmail: params.user.userEmail,
    userRole: params.user.userRole,
    userId: params.user.userId,
    userAgent: params.userAgent,
    occurredAt: params.occurredAt,
    errorId: params.errorId,
    appBaseUrl: `https://${ROOT_DOMAIN}`,
  })
  const html = await render(element)
  const text = await render(element, { plainText: true })

  const subjectWho = params.user.userName || params.user.userEmail || 'unauth'
  const subject = `[Gradus ${params.source}] ${truncate(params.message, 80)} — ${subjectWho}`

  for (const to of ALERT_RECIPIENTS) {
    const messageId = `error-alert-${params.errorId}-${to}`
    await params.supabaseAdmin.from('email_send_log').insert({
      message_id: messageId,
      template_name: 'error-alert',
      recipient_email: to,
      status: 'pending',
    })
    const { error: enqueueError } = await params.supabaseAdmin.rpc('enqueue_email', {
      queue_name: 'transactional_emails',
      payload: {
        run_id: messageId,
        message_id: messageId,
        to,
        from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject,
        html,
        text,
        purpose: 'transactional',
        label: 'error-alert',
        queued_at: new Date().toISOString(),
      },
    })
    if (enqueueError) {
      console.error('[error-tracking] enqueue failed', enqueueError)
      await params.supabaseAdmin.from('email_send_log').insert({
        message_id: messageId,
        template_name: 'error-alert',
        recipient_email: to,
        status: 'failed',
        error_message: 'Failed to enqueue alert email',
      })
    }
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
