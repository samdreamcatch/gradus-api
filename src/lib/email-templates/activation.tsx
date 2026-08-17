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
  colors,
  container,
  divider,
  eyebrow,
  fonts,
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

export type ActivationRole = "coach" | "parent" | "athlete";

export interface ActivationEmailProps {
  role: ActivationRole;
  firstName?: string | null;
  settingsUrl?: string;
  siteUrl?: string;
  copyOverrides?: Record<string, string>;
}

const suffixFor = (role: ActivationRole) =>
  role === "coach" ? "Coach" : role === "parent" ? "Parent" : "Athlete";

function slot(
  c: Record<string, string>,
  base: string,
  role: ActivationRole,
  fallback = "",
): string {
  return c[`${base}${suffixFor(role)}`] ?? c[base] ?? fallback;
}

export function activationSubject(
  data: { role?: ActivationRole } = {},
  copyOverrides?: Record<string, string>,
): string {
  const c = resolveCopy("activation", copyOverrides);
  return slot(c, "subject", data.role ?? "athlete");
}

const bulletRow: React.CSSProperties = {
  fontFamily: fonts.body,
  fontSize: "16px",
  lineHeight: 1.55,
  color: colors.ink,
  margin: "0 0 14px",
  paddingLeft: "18px",
  textIndent: "-18px",
};

export const ActivationEmail = ({
  role = "athlete",
  firstName,
  settingsUrl = "https://gradus.training",
  siteUrl = "https://gradus.training",
  copyOverrides,
}: ActivationEmailProps) => {
  const c = resolveCopy("activation", copyOverrides);
  const vars = { firstName: firstName ?? "there", settingsUrl, siteUrl };

  const bullets = slot(c, "bullets", role)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{renderTemplateString(slot(c, "preview", role), vars)}</Preview>
      <Body style={main}>
        <PageShell>
          <Container style={container}>
            <Header />
            <PageInner>
              <Text style={eyebrow}>{renderTemplateString(c.eyebrow, vars)}</Text>
              <Heading style={h1}>{renderTemplateString(slot(c, "heading", role), vars)}</Heading>
              <Text style={text}>{parse(renderTemplateString(slot(c, "intro", role), vars))}</Text>
              {bullets.map((b, i) => (
                <Text key={i} style={bulletRow}>
                  {"• "}
                  {parse(renderTemplateString(b, vars))}
                </Text>
              ))}
              <div style={{ ...buttonWrap, marginTop: "28px" }}>
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
  component: ActivationEmail,
  subject: (data: Record<string, any>) => activationSubject(data),
  displayName: "Activation — first connection",
  previewData: {
    role: "parent" as ActivationRole,
    firstName: "Alex",
    settingsUrl: "https://gradus.training/parent/settings",
  },
} satisfies TemplateEntry;

export default ActivationEmail;
