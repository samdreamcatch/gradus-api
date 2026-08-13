import * as React from "react";
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
} from "@react-email/components";
import {
  button,
  buttonWrap,
  container,
  divider,
  eyebrow,
  footer,
  h1,
  link,
  main,
  sign,
  text,
} from "./_styles";
import { Header, PageInner, PageShell } from "./_layout";
import type { TemplateEntry } from "./registry";

export interface GuardianInviteEmailProps {
  athleteName: string;
  /** Coach who added the athlete, when the coach initiated it. */
  coachName?: string | null;
  claimUrl: string;
  siteUrl?: string;
}

export const GuardianInviteEmail = ({
  athleteName,
  coachName,
  claimUrl,
  siteUrl = "https://gradus.training",
}: GuardianInviteEmailProps) => {
  const intro = coachName
    ? `Coach ${coachName} added ${athleteName} to Gradus, the training app their coach uses to assign plans, track practice, and message about lessons.`
    : `${athleteName} joined Gradus, the training app their coach uses to assign plans, track practice, and message about lessons.`;

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`See everything ${athleteName} is doing on Gradus`}</Preview>
      <Body style={main}>
        <PageShell>
          <Container style={container}>
            <Header />
            <PageInner>
              <Text style={eyebrow}>Parent / guardian access</Text>
              <Heading style={h1}>{`You've been listed as ${athleteName}'s parent`}</Heading>
              <Text style={text}>{intro}</Text>
              <Text style={text}>
                You were listed as their parent or guardian, so we'll email you a copy of what their
                coach sends. Create your free parent account to see plans, practice logs, and
                messages in one place — nothing to pay, and it takes about a minute.
              </Text>
              <div style={buttonWrap}>
                <Button style={button} href={claimUrl}>
                  See {athleteName}&apos;s training
                </Button>
              </div>
              <Text style={{ ...text, marginTop: "28px", fontSize: "14px" }}>
                Or paste this link into your browser:
                <br />
                <Link href={claimUrl} style={link}>
                  {claimUrl}
                </Link>
              </Text>
              <Text style={sign}>— The Gradus team</Text>
              <Hr style={divider} />
              <Text style={footer}>
                If you don&apos;t recognize this athlete, you can ignore this email and no account
                will be created. <Link href={siteUrl} style={link}>gradus.training</Link>
              </Text>
            </PageInner>
          </Container>
        </PageShell>
      </Body>
    </Html>
  );
};

export const template = {
  component: GuardianInviteEmail,
  subject: (data: Record<string, any>) =>
    data.coachName
      ? `Coach ${data.coachName} added ${data.athleteName ?? "your athlete"} to Gradus`
      : `${data.athleteName ?? "Your athlete"} joined Gradus`,
  displayName: "Guardian invite",
  previewData: {
    athleteName: "Sample Athlete",
    coachName: "Tami Taylor",
    claimUrl: "https://gradus.training/g/preview-token",
  },
} satisfies TemplateEntry;

export default GuardianInviteEmail;
