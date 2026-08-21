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

export interface FamilyInviteEmailProps {
  athleteName: string;
  inviterName: string;
  claimUrl: string;
  code: string;
  siteUrl?: string;
  copyOverrides?: Record<string, string>;
}

export function familyInviteSubject(
  data: { athleteName?: string | null; inviterName?: string | null },
  copyOverrides?: Record<string, string>,
): string {
  const c = resolveCopy("family-invite", copyOverrides);
  return renderTemplateString(c.subject, {
    athleteName: data.athleteName ?? "your athlete",
    inviterName: data.inviterName ?? "A parent",
  });
}

export const FamilyInviteEmail = ({
  athleteName,
  inviterName,
  claimUrl,
  code,
  siteUrl = "https://gradus.training",
  copyOverrides,
}: FamilyInviteEmailProps) => {
  const c = resolveCopy("family-invite", copyOverrides);
  const vars = { athleteName, inviterName, claimUrl, code, siteUrl };

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
                <Button style={button} href={claimUrl}>
                  {renderTemplateString(c.ctaLabel, vars)}
                </Button>
              </div>
              <Text style={{ ...text, marginTop: "28px", fontSize: "14px" }}>
                {renderTemplateString(c.codeHelp, vars)}
              </Text>
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
  component: FamilyInviteEmail,
  subject: (data: Record<string, any>) => familyInviteSubject(data),
  displayName: "Family plan — guardian invite",
  previewData: {
    athleteName: "Sample Athlete",
    inviterName: "Christine Parent",
    code: "K7QW2MTP",
    claimUrl: "https://gradus.training/family/preview-token",
  },
} satisfies TemplateEntry;

export default FamilyInviteEmail;
