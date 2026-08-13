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
import { resolveCopy, renderTemplateString } from "./copy-schema";
import type { TemplateEntry } from "./registry";

export interface GuardianInviteEmailProps {
  athleteName: string;
  /** Coach who added the athlete, when the coach initiated it. */
  coachName?: string | null;
  claimUrl: string;
  siteUrl?: string;
  copyOverrides?: Record<string, string>;
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
}: GuardianInviteEmailProps) => {
  const c = resolveCopy("guardian-invite", copyOverrides);
  const vars = { athleteName, coachName: coachName ?? "", claimUrl, siteUrl };
  const intro = renderTemplateString(coachName ? c.introWithCoach : c.intro, vars);

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
              <Text style={text}>{parse(renderTemplateString(c.body, vars))}</Text>
              <div style={buttonWrap}>
                <Button style={button} href={claimUrl}>
                  {renderTemplateString(c.ctaLabel, vars)}
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
