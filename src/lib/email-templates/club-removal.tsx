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

export interface ClubRemovalEmailProps {
  firstName?: string | null;
  orgName: string;
  /** Human date the free window ends, e.g. "November 19". */
  freeUntil: string;
  billingUrl?: string;
  siteUrl?: string;
  copyOverrides?: Record<string, string>;
}

export function clubRemovalSubject(
  data: { orgName?: string | null } = {},
  copyOverrides?: Record<string, string>,
): string {
  const c = resolveCopy("club-removal", copyOverrides);
  return renderTemplateString(c.subject, { orgName: data.orgName ?? "your club" });
}

export const ClubRemovalEmail = ({
  firstName,
  orgName,
  freeUntil,
  billingUrl = "https://gradus.training/coach/paywall",
  siteUrl = "https://gradus.training",
  copyOverrides,
}: ClubRemovalEmailProps) => {
  const c = resolveCopy("club-removal", copyOverrides);
  const vars = {
    firstName: firstName ?? "there",
    orgName,
    freeUntil,
    billingUrl,
    siteUrl,
  };

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
                <Button style={button} href={billingUrl}>
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
  component: ClubRemovalEmail,
  subject: (data: Record<string, any>) => clubRemovalSubject(data),
  displayName: "Removed from club",
  previewData: {
    firstName: "Tami",
    orgName: "Test Club",
    freeUntil: "November 19",
  },
} satisfies TemplateEntry;

export default ClubRemovalEmail;
