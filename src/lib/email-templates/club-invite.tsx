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

export interface ClubInviteEmailProps {
  orgName: string;
  inviteUrl: string;
  inviteCode: string;
  siteUrl?: string;
  copyOverrides?: Record<string, string>;
}

export function clubInviteSubject(
  data: { orgName?: string | null } = {},
  copyOverrides?: Record<string, string>,
): string {
  const c = resolveCopy("club-invite", copyOverrides);
  return renderTemplateString(c.subject, { orgName: data.orgName ?? "your club" });
}

export const ClubInviteEmail = ({
  orgName,
  inviteUrl,
  inviteCode,
  siteUrl = "https://gradus.training",
  copyOverrides,
}: ClubInviteEmailProps) => {
  const c = resolveCopy("club-invite", copyOverrides);
  const vars = { orgName, inviteUrl, inviteCode, siteUrl };

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
              <Text style={text}>{parse(renderTemplateString(c.intro, vars))}</Text>
              <Text style={text}>{parse(renderTemplateString(c.body, vars))}</Text>
              <div style={buttonWrap}>
                <Button style={button} href={inviteUrl}>
                  {renderTemplateString(c.ctaLabel, vars)}
                </Button>
              </div>
              <Text style={{ ...text, marginTop: "28px", fontSize: "14px" }}>
                {renderTemplateString(c.fallbackHelp, vars)}
                <br />
                <Link href={inviteUrl} style={link}>
                  {inviteUrl}
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
  component: ClubInviteEmail,
  subject: (data: Record<string, any>) => clubInviteSubject(data),
  displayName: "Club coach invite",
  previewData: {
    orgName: "Test Club",
    inviteUrl: "https://gradus.training/i/TESTCASE",
    inviteCode: "TESTCASE",
  },
} satisfies TemplateEntry;

export default ClubInviteEmail;
