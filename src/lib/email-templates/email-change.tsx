import * as React from "react";
import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";
import parse, { domToReact, type HTMLReactParserOptions, type DOMNode } from "html-react-parser";
import { button, container, divider, eyebrow, footer, h1, link, main, text, colors } from "./_styles";
import { Header } from "./_layout";
import { resolveCopy, renderTemplateString } from "./copy-schema";

interface EmailChangeEmailProps {
  siteName: string;
  oldEmail: string;
  email: string;
  newEmail: string;
  confirmationUrl: string;
  copyOverrides?: Record<string, string>;
}

// Turns <a>{oldEmail}</a>/<a>{newEmail}</a> in copy into real mailto links.
function makeMailtoParser(oldEmail: string, newEmail: string): HTMLReactParserOptions {
  return {
    replace: (node) => {
      if (node.type === "tag" && node.name === "a") {
        const el = node as unknown as { children: DOMNode[] };
        const inner = domToReact(el.children, {});
        const raw = typeof inner === "string" ? inner : String(inner ?? "").trim();
        const target = raw === newEmail ? newEmail : oldEmail;
        return (
          <a href={`mailto:${target}`} style={link}>
            {raw}
          </a>
        );
      }
    },
  };
}

export const EmailChangeEmail = ({ siteName, oldEmail, email, newEmail, confirmationUrl, copyOverrides }: EmailChangeEmailProps) => {
  const c = resolveCopy("email_change", copyOverrides);
  const vars = { siteName, oldEmail, email, newEmail, confirmationUrl };
  const parser = makeMailtoParser(oldEmail, newEmail);
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{renderTemplateString(c.preview, vars)}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Header />
          <Text style={eyebrow}>{renderTemplateString(c.eyebrow, vars)}</Text>
          <Heading style={h1}>{renderTemplateString(c.heading, vars)}</Heading>
          <Text style={text}>{parse(renderTemplateString(c.body, vars), parser)}</Text>
          <div style={buttonWrap}><Button style={button} href={confirmationUrl}>{renderTemplateString(c.ctaLabel, vars)}</Button></div>
          <Hr style={divider} />
          <Text style={{ ...footer, color: colors.inkSoft }}>{parse(renderTemplateString(c.footer, vars))}</Text>
        </Container>
      </Body>
    </Html>
  );
};

export default EmailChangeEmail;
