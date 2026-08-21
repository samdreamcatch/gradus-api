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

export interface CoachVisibilityEmailProps {
  coachName: string;
  otherCoachName: string;
  athleteName: string;
  parentName: string;
  actionUrl: string;
  siteUrl?: string;
  copyOverrides?: Record<string, string>;
}

export function coachVisibilitySubject(
  data: { otherCoachName?: string | null; athleteName?: string | null } = {},
  copyOverrides?: Record<string, string>,
): string {
  const c = resolveCopy("coach-visibility", copyOverrides);
  return renderTemplateString(c.subject, {
    otherCoachName: data.otherCoachName ?? "another coach",
    athleteName: data.athleteName ?? "your athlete",
  });
}

export const CoachVisibilityEmail = ({
  coachName,
  otherCoachName,
  athleteName,
  parentName,
  actionUrl,
  siteUrl = "https://gradus.training",
  copyOverrides,
}: CoachVisibilityEmailProps) => {
  const c = resolveCopy("coach-visibility", copyOverrides);
  const vars = { coachName, otherCoachName, athleteName, parentName, actionUrl, siteUrl };

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
                <Button style={button} href={actionUrl}>
                  {renderTemplateString(c.ctaLabel, vars)}
                </Button>
              </div>
              <Text style={{ ...text, marginTop: "28px", fontSize: "14px" }}>
                {renderTemplateString(c.fallbackHelp, vars)}
                <br />
                <Link href={actionUrl} style={link}>
                  {actionUrl}
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
  component: CoachVisibilityEmail,
  subject: (data: Record<string, any>) => coachVisibilitySubject(data),
  displayName: "Coach visibility request",
  previewData: {
    coachName: "Tami Taylor",
    otherCoachName: "David Wallace",
    athleteName: "Jamie Gilmore",
    parentName: "Christine Gilmore",
    actionUrl: "https://gradus.training/coach/settings",
  },
} satisfies TemplateEntry;

export default CoachVisibilityEmail;
