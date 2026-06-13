import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Text,
} from '@react-email/components'

import {
  button,
  container,
  divider,
  eyebrow,
  footer,
  h1,
  link,
  main,
  sign,
  text,
  wordmark,
} from './_styles'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email to start training with {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={wordmark}>Gradus</Text>
        <Text style={eyebrow}>Confirm your email</Text>

        <Heading style={h1}>One quick step to get started.</Heading>

        <Text style={text}>
          Thanks for signing up for{' '}
          <Link href={siteUrl} style={link}>
            {siteName}
          </Link>
          . Confirm <strong>{recipient}</strong> so we can save your progress
          and connect you to your coach.
        </Text>

        <Button style={button} href={confirmationUrl}>
          Verify my email
        </Button>

        <Text style={{ ...text, marginTop: '28px', fontSize: '14px' }}>
          Button not working? Paste this link into your browser:
          <br />
          <Link href={confirmationUrl} style={link}>
            {confirmationUrl}
          </Link>
        </Text>

        <Text style={sign}>— The Gradus team</Text>

        <Hr style={divider} />
        <Text style={footer}>
          If you didn't create a Gradus account, you can safely ignore this
          email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail
