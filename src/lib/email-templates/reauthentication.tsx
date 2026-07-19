import * as React from "react";
import { Body, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";
import parse from "html-react-parser";
import { code, container, divider, eyebrow, footer, h1, main, text } from "./_styles";
import { Header, PageInner, PageShell } from "./_layout";
import { resolveCopy, renderTemplateString } from "./copy-schema";

interface ReauthenticationEmailProps {
  token: string;
  copyOverrides?: Record<string, string>;
}

export const ReauthenticationEmail = ({ token, copyOverrides }: ReauthenticationEmailProps) => {
  const c = resolveCopy("reauthentication", copyOverrides);
  const vars = { token };
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
          <Text style={code}>{token}</Text>
          <Hr style={divider} />
          <Text style={footer}>{parse(renderTemplateString(c.footer, vars))}</Text>
        </Container>
      </Body>
    </Html>
  );
};

export default ReauthenticationEmail;
