import * as React from "react";

import { Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Text } from "@react-email/components";

import { button, container, divider, eyebrow, footer, h1, link, main, text, wordmark, colors } from "./_styles";

interface EmailChangeEmailProps {
  siteName: string;
  // oldEmail is the user's current address (HookData.OldEmail). For the
  // NEW-recipient half of a secure email_change fanout, `email` equals the
  // recipient (NEW), so the "from" line must render oldEmail to read
  // "from OLD to NEW" instead of "from NEW to NEW".
  oldEmail: string;
  email: string;
  newEmail: string;
  confirmationUrl: string;
}

export const EmailChangeEmail = ({ siteName, oldEmail, newEmail, confirmationUrl }: EmailChangeEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email change for Gradus </Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={wordmark}>Gradus</Text>
        <Text style={eyebrow}>Email change request</Text>

        <Heading style={h1}>Confirm your new email.</Heading>

        <Text style={text}>
          You asked to change your <strong>Gradus</strong> email from{" "}
          <Link href={`mailto:${oldEmail}`} style={link}>
            {oldEmail}
          </Link>{" "}
          to{" "}
          <Link href={`mailto:${newEmail}`} style={link}>
            {newEmail}
          </Link>
          .
        </Text>

        <Button style={button} href={confirmationUrl}>
          Confirm email change
        </Button>

        <Hr style={divider} />
        <Text style={{ ...footer, color: colors.inkSoft }}>
          <strong>Didn't request this?</strong> Reset your password right away to secure your account.
        </Text>
      </Container>
    </Body>
  </Html>
);

export default EmailChangeEmail;
