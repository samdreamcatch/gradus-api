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
import { htmlTemplateValues, resolveCopy, renderTemplateString } from "./copy-schema";
import type { TemplateEntry } from "./registry";

export interface GuardianActivityEmailProps {
  athleteName: string;
  senderName: string;
  senderRole: "coach" | "athlete";
  body: string;
  claimUrl: string;
  siteUrl?: string;
  copyOverrides?: Record<string, string>;
  /** The address already has a Gradus parent account: "Sign in to confirm", not "create". */
  existingAccount?: boolean;
}

/**
 * "Coach Jen Park", never "Coach Coach …": some coaches type the title into
 * their own name, and the guardian mirror used to pass a name it had already
 * prefixed (beta feedback 2026-10-07: a message email read "Coach Coach …").
 */
export function coachLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Your athlete's coach";
  // Not `\b`: in a non-Unicode regex "Coaché…" would count as the title.
  return /^coach(?![\p{L}\p{N}])/iu.test(trimmed) ? trimmed : `Coach ${trimmed}`;
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
    senderLabel: data.senderRole === "coach" ? coachLabel(senderName) : senderName,
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
  existingAccount = false,
}: GuardianActivityEmailProps) => {
  const c = resolveCopy("guardian-activity", copyOverrides);
  const vars = activityVars({ athleteName, senderName, senderRole, body, claimUrl, siteUrl });
  // Names and the message were typed by people; parsed slots get them escaped.
  const htmlVars = htmlTemplateValues(vars);
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
              <Text style={text}>
                {parse(
                  renderTemplateString(existingAccount ? c.bodyExistingAccount : c.body, htmlVars),
                )}
              </Text>
              <div style={buttonWrap}>
                <Button style={button} href={claimUrl}>
                  {renderTemplateString(
                    existingAccount ? c.ctaLabelExistingAccount : c.ctaLabel,
                    vars,
                  )}
                </Button>
              </div>
              <Hr style={divider} />
              <Text style={footer}>
                {parse(
                  renderTemplateString(
                    existingAccount ? c.footerExistingAccount : c.footer,
                    htmlVars,
                  ),
                )}{" "}
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
