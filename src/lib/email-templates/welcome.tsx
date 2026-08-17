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

export interface WelcomeEmailProps {
  /** First name when we have one. */
  firstName?: string | null;
  /** Role-aware destination for the CTA (settings page). */
  settingsUrl?: string;
  siteUrl?: string;
  copyOverrides?: Record<string, string>;
}

export function welcomeSubject(
  _data: Record<string, unknown> = {},
  copyOverrides?: Record<string, string>,
): string {
  return resolveCopy("welcome", copyOverrides).subject;
}

export const WelcomeEmail = ({
  firstName,
  settingsUrl = "https://gradus.training",
  siteUrl = "https://gradus.training",
  copyOverrides,
}: WelcomeEmailProps) => {
  const c = resolveCopy("welcome", copyOverrides);
  const vars = { firstName: firstName ?? "there", settingsUrl, siteUrl };

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
              <Text style={text}>{parse(renderTemplateString(c.body, vars))}</Text>
              <Text style={text}>{parse(renderTemplateString(c.nextStep, vars))}</Text>
              <div style={buttonWrap}>
                <Button style={button} href={settingsUrl}>
                  {renderTemplateString(c.ctaLabel, vars)}
                </Button>
              </div>
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
  component: WelcomeEmail,
  subject: (data: Record<string, any>) => welcomeSubject(data),
  displayName: "Welcome",
  previewData: {
    firstName: "Alex",
    settingsUrl: "https://gradus.training/coach/settings",
  },
} satisfies TemplateEntry;

export default WelcomeEmail;
