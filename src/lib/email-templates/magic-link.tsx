import * as React from "react";

import { Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Text } from "@react-email/components";

import { button, container, divider, eyebrow, footer, h1, link, main, text, wordmark } from "./_styles";

interface MagicLinkEmailProps {
  siteName: string;
  confirmationUrl: string;
}

export const MagicLinkEmail = ({ siteName, confirmationUrl }: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your one-tap login link for Gradus</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={wordmark}>Gradus</Text>
        <Text style={eyebrow}>Sign-in link</Text>

        <Heading style={h1}>Tap to sign in.</Heading>

        <Text style={text}>
          Use the button below to log in to <strong>Gradus</strong>. The link expires shortly, so use it soon.
        </Text>

        <Button style={button} href={confirmationUrl}>
          Sign in to Gradus
        </Button>

        <Text style={{ ...text, marginTop: "28px", fontSize: "14px" }}>
          Or paste this URL into your browser:
          <br />
          <Link href={confirmationUrl} style={link}>
            {confirmationUrl}
          </Link>
        </Text>

        <Hr style={divider} />
        <Text style={footer}>If you didn't request this link, you can safely ignore this email.</Text>
      </Container>
    </Body>
  </Html>
);

export default MagicLinkEmail;
