import * as React from "react";
import { Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Text } from "@react-email/components";
import parse from "html-react-parser";
import { button, container, divider, eyebrow, footer, h1, link, main, text, buttonWrap } from "./_styles";
import { Header, PageInner, PageShell } from "./_layout";
import { resolveCopy, renderTemplateString } from "./copy-schema";

interface MagicLinkEmailProps {
  siteName: string;
  confirmationUrl: string;
  siteUrl?: string;
  recipient?: string;
  copyOverrides?: Record<string, string>;
}

export const MagicLinkEmail = ({ siteName, confirmationUrl, siteUrl, recipient, copyOverrides }: MagicLinkEmailProps) => {
  const c = resolveCopy("magiclink", copyOverrides);
  const vars = { siteName, confirmationUrl, siteUrl: siteUrl ?? "", recipient: recipient ?? "" };
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
              <div style={buttonWrap}><Button style={button} href={confirmationUrl}>{renderTemplateString(c.ctaLabel, vars)}</Button></div>
              <Text style={{ ...text, marginTop: "28px", fontSize: "14px" }}>
                {renderTemplateString(c.fallbackHelp, vars)}
                <br />
                <Link href={confirmationUrl} style={link}>{confirmationUrl}</Link>
              </Text>
              <Hr style={divider} />
              <Text style={footer}>{parse(renderTemplateString(c.footer, vars))}</Text>
            </PageInner>
          </Container>
        </PageShell>
      </Body>

    </Html>
  );
};

export default MagicLinkEmail;
