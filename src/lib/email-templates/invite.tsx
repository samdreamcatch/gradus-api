import * as React from "react";
import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";
import parse from "html-react-parser";
import { button, container, divider, eyebrow, footer, h1, main, sign, text } from "./_styles";
import { Header } from "./_layout";
import { resolveCopy, renderTemplateString } from "./copy-schema";

interface InviteEmailProps {
  siteName: string;
  siteUrl: string;
  confirmationUrl: string;
  recipient?: string;
  copyOverrides?: Record<string, string>;
}

export const InviteEmail = ({ siteName, siteUrl, confirmationUrl, recipient, copyOverrides }: InviteEmailProps) => {
  const c = resolveCopy("invite", copyOverrides);
  const vars = { siteName, siteUrl, confirmationUrl, recipient: recipient ?? "" };
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{renderTemplateString(c.preview, vars)}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Header />
          <Text style={eyebrow}>{renderTemplateString(c.eyebrow, vars)}</Text>
          <Heading style={h1}>{renderTemplateString(c.heading, vars)}</Heading>
          <Text style={text}>{parse(renderTemplateString(c.body, vars))}</Text>
          <div style={buttonWrap}><Button style={button} href={confirmationUrl}>{renderTemplateString(c.ctaLabel, vars)}</Button></div>
          <Text style={sign}>{renderTemplateString(c.signOff, vars)}</Text>
          <Hr style={divider} />
          <Text style={footer}>{parse(renderTemplateString(c.footer, vars))}</Text>
        </Container>
      </Body>
    </Html>
  );
};

export default InviteEmail;
