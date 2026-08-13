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
  text,
} from "./_styles";
import { Header, PageInner, PageShell } from "./_layout";
import type { TemplateEntry } from "./registry";

export interface GuardianActivityEmailProps {
  athleteName: string;
  senderName: string;
  senderRole: "coach" | "athlete";
  body: string;
  claimUrl: string;
  siteUrl?: string;
}

/**
 * Mirror of a message in an athlete-scoped room, sent to a guardian who has
 * not created an account yet. Transparency without a download.
 */
export const GuardianActivityEmail = ({
  athleteName,
  senderName,
  senderRole,
  body,
  claimUrl,
  siteUrl = "https://gradus.training",
}: GuardianActivityEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`New message about ${athleteName} on Gradus`}</Preview>
    <Body style={main}>
      <PageShell>
        <Container style={container}>
          <Header />
          <PageInner>
            <Text style={eyebrow}>Copy for {athleteName}&apos;s parent</Text>
            <Heading style={h1}>
              {senderRole === "coach" ? `Coach ${senderName}` : senderName} sent a message
            </Heading>
            <Text style={quote}>{body}</Text>
            <Text style={text}>
              You&apos;re getting this because you&apos;re listed as {athleteName}&apos;s parent or
              guardian and haven&apos;t created your Gradus account yet. Create it to reply and see
              everything in one place.
            </Text>
            <div style={buttonWrap}>
              <Button style={button} href={claimUrl}>
                Create my parent account
              </Button>
            </div>
            <Hr style={divider} />
            <Text style={footer}>
              These copies stop as soon as you create your account.{" "}
              <Link href={siteUrl} style={link}>
                gradus.training
              </Link>
            </Text>
          </PageInner>
        </Container>
      </PageShell>
    </Body>
  </Html>
);

const quote: React.CSSProperties = {
  ...text,
  borderLeft: "3px solid #C0DD27",
  paddingLeft: "14px",
  fontStyle: "italic",
};

export const template = {
  component: GuardianActivityEmail,
  subject: (data: Record<string, any>) =>
    `New message about ${data.athleteName ?? "your athlete"} on Gradus`,
  displayName: "Guardian message copy",
  previewData: {
    athleteName: "Sample Athlete",
    senderName: "Tami Taylor",
    senderRole: "coach",
    body: "Great session today — let's work on the loop jump entry next week.",
    claimUrl: "https://gradus.training/g/preview-token",
  },
} satisfies TemplateEntry;

export default GuardianActivityEmail;
