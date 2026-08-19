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

/** Which billing event this notice is about. */
export type BillingNoticeKind = "trial_ending" | "payment_failed" | "canceled";

export interface BillingNoticeEmailProps {
  kind: BillingNoticeKind;
  firstName?: string | null;
  /** Human date the trial ends / the sub ended, e.g. "September 3". */
  eventDate?: string;
  planLabel?: string;
  billingUrl?: string;
  siteUrl?: string;
  copyOverrides?: Record<string, string>;
}

const SUFFIX: Record<BillingNoticeKind, string> = {
  trial_ending: "TrialEnding",
  payment_failed: "PaymentFailed",
  canceled: "Canceled",
};

function slot(c: Record<string, string>, base: string, kind: BillingNoticeKind): string {
  return c[`${base}${SUFFIX[kind]}`] ?? c[base] ?? "";
}

export function billingNoticeSubject(
  data: { kind?: BillingNoticeKind; firstName?: string | null; planLabel?: string } = {},
  copyOverrides?: Record<string, string>,
): string {
  const kind = data.kind ?? "trial_ending";
  const c = resolveCopy("billing-notice", copyOverrides);
  return renderTemplateString(slot(c, "subject", kind), {
    firstName: data.firstName ?? "there",
    planLabel: data.planLabel ?? "your plan",
  });
}

export const BillingNoticeEmail = ({
  kind = "trial_ending",
  firstName,
  eventDate = "",
  planLabel = "your plan",
  billingUrl = "https://gradus.training/coach/settings",
  siteUrl = "https://gradus.training",
  copyOverrides,
}: BillingNoticeEmailProps) => {
  const c = resolveCopy("billing-notice", copyOverrides);
  const vars = {
    firstName: firstName ?? "there",
    eventDate,
    planLabel,
    billingUrl,
    siteUrl,
  };

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{renderTemplateString(slot(c, "preview", kind), vars)}</Preview>
      <Body style={main}>
        <PageShell>
          <Container style={container}>
            <Header />
            <PageInner>
              <Text style={eyebrow}>{renderTemplateString(slot(c, "eyebrow", kind), vars)}</Text>
              <Heading style={h1}>{renderTemplateString(slot(c, "heading", kind), vars)}</Heading>
              <Text style={text}>{parse(renderTemplateString(slot(c, "body", kind), vars))}</Text>
              <Text style={text}>
                {parse(renderTemplateString(slot(c, "detail", kind), vars))}
              </Text>
              <div style={{ ...buttonWrap, marginTop: "28px" }}>
                <Button style={button} href={billingUrl}>
                  {renderTemplateString(slot(c, "ctaLabel", kind), vars)}
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
  component: BillingNoticeEmail,
  subject: (data: Record<string, any>) => billingNoticeSubject(data),
  displayName: "Billing — trial ending / payment failed / canceled",
  previewData: {
    kind: "trial_ending" as BillingNoticeKind,
    firstName: "Tami",
    eventDate: "September 3",
    planLabel: "Coach Pro",
    billingUrl: "https://gradus.training/coach/settings",
  },
} satisfies TemplateEntry;

export default BillingNoticeEmail;
