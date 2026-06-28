import * as React from "react";

import { Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Text } from "@react-email/components";

import { button, container, divider, eyebrow, footer, h1, link, main, text, wordmark } from "./_styles";

interface RecoveryEmailProps {
  siteName: string;
  confirmationUrl: string;
}

export const RecoveryEmail = ({ siteName, confirmationUrl }: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Reset your Gradus password</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={wordmark}>Gradus</Text>
        <Text style={eyebrow}>Password reset</Text>

        <Heading style={h1}>Let's get you back in.</Heading>

        <Text style={text}>
          We received a request to reset your password for <strong>Gradus</strong>. Choose a new one with the button
          below.
        </Text>

        <Button style={button} href={confirmationUrl}>
          Choose a new password
        </Button>

        <Text style={{ ...text, marginTop: "28px", fontSize: "14px" }}>
          Or paste this URL into your browser:
          <br />
          <Link href={confirmationUrl} style={link}>
            {confirmationUrl}
          </Link>
        </Text>

        <Hr style={divider} />
        <Text style={footer}>
          If you didn't request a password reset, you can safely ignore this email — your password will stay the same.
        </Text>
      </Container>
    </Body>
  </Html>
);

export default RecoveryEmail;
