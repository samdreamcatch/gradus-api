import * as React from 'react'

import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from '@react-email/components'

import {
  code,
  container,
  divider,
  eyebrow,
  footer,
  h1,
  main,
  text,
  wordmark,
} from './_styles'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your Gradus verification code</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={wordmark}>Gradus</Text>
        <Text style={eyebrow}>Verification code</Text>

        <Heading style={h1}>Confirm it's you.</Heading>

        <Text style={text}>
          Enter the code below to confirm your identity:
        </Text>

        <Text style={code}>{token}</Text>

        <Hr style={divider} />
        <Text style={footer}>
          This code expires shortly. If you didn't request it, you can safely
          ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail
