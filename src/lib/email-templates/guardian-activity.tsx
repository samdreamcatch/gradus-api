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
import parse from "html-react-parser";
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
import { resolveCopy, renderTemplateString } from "./copy-schema";
import type { TemplateEntry } from "./registry";

export interface GuardianActivityEmailProps {
  athleteName: string;
  senderName: string;
  senderRole: "coach" | "athlete";
  body: string;
  claimUrl: string;
  siteUrl?: string;
  copyOverrides?: Record<string, string>;
}

function activityVars(data: {
  athleteName?: string | null;
  senderName?: string | null;
  senderRole?: string | null;
  body?: string | null;
  claimUrl?: string | null;
  siteUrl?: string | null;
}) {
  const senderName = data.senderName ?? "";
  return {
    athleteName: data.athleteName ?? "your athlete",
    senderName,
    senderRole: data.senderRole ?? "coach",
    senderLabel: data.senderRole === "coach" ? `Coach ${senderName}` : senderName,
    body: data.body ?? "",
    claimUrl: data.claimUrl ?? "",
    siteUrl: data.siteUrl ?? "https://gradus.training",
  };
}

export function guardianActivitySubject(
  data: Record<string, any>,
  copyOverrides?: Record<string, string>,
): string {
  const c = resolveCopy("guardian-activity", copyOverrides);
  return renderTemplateString(c.subject, activityVars(data));
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
  copyOverrides,
}: GuardianActivityEmailProps) => {
  const c = resolveCopy("guardian-activity", copyOverrides);
  const vars = activityVars({ athleteName, senderName, senderRole, body, claimUrl, siteUrl });
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{renderTemplateString(c.preview, vars)}</Preview>
      <Body style={main}>
        <PageShell>
          <Container style={container}>
            <Header />
            <PageInner>
              <Text style={eyebrow}>{renderTemplateString(c.eyebrow, vars)}</Text>
              <Heading style={h1}>{renderTemplateString(c.heading, vars)}</Heading>
              <Text style={quote}>{body}</Text>
              <Text style={text}>{parse(renderTemplateString(c.body, vars))}</Text>
              <div style={buttonWrap}>
                <Button style={button} href={claimUrl}>
                  {renderTemplateString(c.ctaLabel, vars)}
                </Button>
              </div>
              <Hr style={divider} />
              <Text style={footer}>
                {parse(renderTemplateString(c.footer, vars))}{" "}
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
};

const quote: React.CSSProperties = {
  ...text,
  borderLeft: "3px solid #C0DD27",
  paddingLeft: "14px",
  fontStyle: "italic",
};

export const template = {
  component: GuardianActivityEmail,
  subject: (data: Record<string, any>) => guardianActivitySubject(data),
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
