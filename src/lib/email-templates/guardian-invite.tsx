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
  sign,
  text,
} from "./_styles";
import { Header, PageInner, PageShell } from "./_layout";
import { htmlTemplateValues, resolveCopy, renderTemplateString } from "./copy-schema";
import type { TemplateEntry } from "./registry";

export interface GuardianInviteEmailProps {
  athleteName: string;
  /** Coach who added the athlete, when the coach initiated it. */
  coachName?: string | null;
  claimUrl: string;
  siteUrl?: string;
  copyOverrides?: Record<string, string>;
  /** The address already has a Gradus parent account: "Sign in to confirm", not "create". */
  existingAccount?: boolean;
}

export function guardianInviteSubject(
  data: { athleteName?: string | null; coachName?: string | null },
  copyOverrides?: Record<string, string>,
): string {
  const c = resolveCopy("guardian-invite", copyOverrides);
  const vars = {
    athleteName: data.athleteName ?? "Your athlete",
    coachName: data.coachName ?? "",
  };
  return renderTemplateString(data.coachName ? c.subjectWithCoach : c.subject, vars);
}

export const GuardianInviteEmail = ({
  athleteName,
  coachName,
  claimUrl,
  siteUrl = "https://gradus.training",
  copyOverrides,
  existingAccount = false,
}: GuardianInviteEmailProps) => {
  const c = resolveCopy("guardian-invite", copyOverrides);
  const vars = { athleteName, coachName: coachName ?? "", claimUrl, siteUrl };
  // The coach typed the names; parsed slots get them escaped.
  const htmlVars = htmlTemplateValues(vars);
  const intro = renderTemplateString(coachName ? c.introWithCoach : c.intro, htmlVars);

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
              <Text style={text}>{parse(intro)}</Text>
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
              <Text style={{ ...text, marginTop: "28px", fontSize: "14px" }}>
                {renderTemplateString(c.fallbackHelp, vars)}
                <br />
                <Link href={claimUrl} style={link}>
                  {claimUrl}
                </Link>
              </Text>
              <Text style={sign}>{renderTemplateString(c.signOff, vars)}</Text>
              <Text style={{ ...text, marginTop: "20px", fontSize: "13px" }}>
                {parse(renderTemplateString(c.notice, htmlVars))}
                {/* Only a 13–17 self-sign-up is swept after three months; a coach-added athlete is not. */}
                {coachName ? null : " " + renderTemplateString(c.noticeUnclaimed, vars)}
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
  component: GuardianInviteEmail,
  subject: (data: Record<string, any>) => guardianInviteSubject(data),
  displayName: "Guardian invite",
  previewData: {
    athleteName: "Sample Athlete",
    coachName: "Tami Taylor",
    claimUrl: "https://gradus.training/g/preview-token",
  },
} satisfies TemplateEntry;

export default GuardianInviteEmail;
