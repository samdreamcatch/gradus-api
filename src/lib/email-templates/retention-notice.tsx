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

export interface RetentionNoticeEmailProps {
  athleteName: string;
  /** Already formatted for the reader ("November 2, 2026"). */
  deleteDate: string;
  siteUrl?: string;
  copyOverrides?: Record<string, string>;
}

/**
 * The body and footer go through html-react-parser, so a name a 13–17
 * self-sign-up typed must not carry markup there. Everywhere else React
 * escapes text itself, and the subject is plain text; escaping those too
 * would show `&#39;` in the inbox.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function noticeVars(data: {
  athleteName?: string | null;
  deleteDate?: string | null;
  siteUrl?: string | null;
}) {
  const siteUrl = data.siteUrl ?? "https://gradus.training";
  return {
    athleteName: data.athleteName ?? "your athlete",
    deleteDate: data.deleteDate ?? "",
    siteUrl,
    loginUrl: `${siteUrl}/login`,
  };
}

export function retentionNoticeSubject(
  data: Record<string, any>,
  copyOverrides?: Record<string, string>,
): string {
  const c = resolveCopy("retention-notice", copyOverrides);
  return renderTemplateString(c.subject, noticeVars(data));
}

/**
 * Thirty days before a dormant athlete account is deleted (retention policy,
 * PRD §6.13 A9, decision #41): sent to every guardian on file. Signing in
 * cancels the deletion; nothing else is asked.
 */
export const RetentionNoticeEmail = ({
  athleteName,
  deleteDate,
  siteUrl = "https://gradus.training",
  copyOverrides,
}: RetentionNoticeEmailProps) => {
  const c = resolveCopy("retention-notice", copyOverrides);
  const vars = noticeVars({ athleteName, deleteDate, siteUrl });
  const htmlVars = { ...vars, athleteName: escapeHtml(vars.athleteName) };
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
              <Text style={text}>{parse(renderTemplateString(c.body, htmlVars))}</Text>
              <div style={buttonWrap}>
                <Button style={button} href={vars.loginUrl}>
                  {renderTemplateString(c.ctaLabel, vars)}
                </Button>
              </div>
              <Text style={{ ...text, marginTop: "28px", fontSize: "14px" }}>
                Or paste this link into your browser:
                <br />
                <Link href={vars.loginUrl} style={link}>
                  {vars.loginUrl}
                </Link>
              </Text>
              <Hr style={divider} />
              <Text style={footer}>
                {parse(renderTemplateString(c.footer, htmlVars))}{" "}
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

export const template = {
  component: RetentionNoticeEmail,
  subject: (data: Record<string, any>) => retentionNoticeSubject(data),
  displayName: "Retention notice",
  previewData: {
    athleteName: "Sample Athlete",
    deleteDate: "November 2, 2026",
    siteUrl: "https://gradus.training",
  },
} satisfies TemplateEntry;

export default RetentionNoticeEmail;
