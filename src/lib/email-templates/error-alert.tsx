import * as React from 'react'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import { colors, fonts } from './_styles'

interface Props {
  message: string
  stack?: string | null
  route?: string | null
  source: 'client' | 'server'
  userName?: string | null
  userEmail?: string | null
  userRole?: string | null
  userId?: string | null
  userAgent?: string | null
  occurredAt: string
  errorId: string
  appBaseUrl: string
}

export const ErrorAlertEmail = ({
  message,
  stack,
  route,
  source,
  userName,
  userEmail,
  userRole,
  userId,
  userAgent,
  occurredAt,
  errorId,
  appBaseUrl,
}: Props) => {
  const detailUrl = `${appBaseUrl}/admin/errors/${errorId}`
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`[${source}] ${message.slice(0, 80)}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={kicker}>Gradus · error report</Text>
          <Heading style={h1}>{source === 'client' ? 'Browser error' : 'Server error'}</Heading>
          <Text style={messageStyle}>{message}</Text>

          <Section style={card}>
            <Row label="Who" value={userName || userEmail || '(not signed in)'} />
            {userEmail && <Row label="Email" value={userEmail} />}
            {userRole && <Row label="Role" value={userRole} />}
            {userId && <Row label="User ID" value={userId} mono />}
            <Row label="Route" value={route || '—'} mono />
            <Row label="Source" value={source} />
            <Row label="Occurred" value={occurredAt} />
            {userAgent && <Row label="User agent" value={userAgent} />}
          </Section>

          {stack && (
            <Section style={{ marginTop: 16 }}>
              <Text style={label}>Stack</Text>
              <pre style={pre}>{stack.split('\n').slice(0, 30).join('\n')}</pre>
            </Section>
          )}

          <Text style={{ ...meta, marginTop: 24 }}>
            <a href={detailUrl} style={link}>View in admin →</a>
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const Row = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <div style={{ display: 'flex', gap: 12, padding: '6px 0' }}>
    <Text style={{ ...rowLabel }}>{label}</Text>
    <Text style={{ ...rowValue, fontFamily: mono ? 'ui-monospace, monospace' : fonts.body }}>
      {value}
    </Text>
  </div>
)

export const template = {
  component: ErrorAlertEmail,
  subject: 'Gradus error report',
  displayName: 'Error alert',
} as const

const main: React.CSSProperties = {
  backgroundColor: '#ffffff',
  fontFamily: fonts.body,
  margin: 0,
  padding: '32px 0',
  color: colors.ink,
}
const container: React.CSSProperties = {
  width: '100%',
  maxWidth: '600px',
  margin: '0 auto',
  padding: '24px 28px',
}
const kicker: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: colors.meta,
  margin: 0,
}
const h1: React.CSSProperties = {
  fontFamily: fonts.display,
  fontSize: 28,
  lineHeight: 1.15,
  margin: '8px 0 12px',
  color: colors.ink,
}
const messageStyle: React.CSSProperties = {
  fontSize: 16,
  lineHeight: 1.5,
  margin: '0 0 20px',
  color: colors.ink,
  fontWeight: 600,
}
const card: React.CSSProperties = {
  border: `1px solid ${colors.hair}`,
  borderRadius: 12,
  padding: '12px 16px',
  background: colors.paper,
}
const label: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: colors.meta,
  margin: '0 0 6px',
}
const rowLabel: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: colors.meta,
  margin: 0,
  width: 90,
  flexShrink: 0,
}
const rowValue: React.CSSProperties = {
  fontSize: 13,
  color: colors.ink,
  margin: 0,
  wordBreak: 'break-word',
}
const pre: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  lineHeight: 1.5,
  background: '#0F172A',
  color: '#E2E8F0',
  padding: '12px 14px',
  borderRadius: 10,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  margin: 0,
}
const meta: React.CSSProperties = {
  fontSize: 12,
  color: colors.meta,
  margin: 0,
}
const link: React.CSSProperties = {
  color: colors.penInk,
  fontWeight: 700,
  textDecoration: 'underline',
}
