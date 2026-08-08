import * as React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { colors, fonts } from "./_styles";
import type { TemplateEntry } from "./registry";

export interface DigestGroup {
  message: string;
  count: number;
  source: "client" | "server";
  lastRoute?: string | null;
  lastOccurredAt: string;
  users: Array<{ label: string; role?: string | null; count: number }>;
  anonCount: number;
  sampleErrorId?: string | null;
}

interface Props {
  windowLabel: string;
  totalErrors: number;
  totalGroups: number;
  groups: DigestGroup[];
  appBaseUrl: string;
}

export const ErrorDigestEmail = ({
  windowLabel,
  totalErrors,
  totalGroups,
  groups,
  appBaseUrl,
}: Props) => {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`${totalErrors} error${totalErrors === 1 ? "" : "s"} in ${totalGroups} group${totalGroups === 1 ? "" : "s"} — ${windowLabel}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={kicker}>Gradus · error digest</Text>
          <Heading style={h1}>
            {totalErrors} error{totalErrors === 1 ? "" : "s"} · {windowLabel}
          </Heading>
          <Text style={intro}>
            {totalGroups} unique error group{totalGroups === 1 ? "" : "s"} on production.
          </Text>

          {groups.map((g, i) => (
            <Section key={i} style={card}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <Text style={countPill}>{`×${g.count}`}</Text>
                <Text style={sourcePill}>{g.source}</Text>
              </div>
              <Text style={groupMsg}>{truncate(g.message, 220)}</Text>
              {g.lastRoute && (
                <Text style={groupMeta}>
                  <span style={metaLabel}>Route </span>
                  <span style={mono}>{g.lastRoute}</span>
                </Text>
              )}
              <Text style={groupMeta}>
                <span style={metaLabel}>Last seen </span>
                {g.lastOccurredAt}
              </Text>
              {(g.users.length > 0 || g.anonCount > 0) && (
                <Text style={groupMeta}>
                  <span style={metaLabel}>Affected </span>
                  {[
                    ...g.users
                      .slice(0, 5)
                      .map((u) => `${u.label}${u.role ? ` (${u.role})` : ""} ×${u.count}`),
                    g.anonCount > 0 ? `anon ×${g.anonCount}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              )}
            </Section>
          ))}

          <Text style={{ ...footerMeta, marginTop: 24 }}>
            <a href={`${appBaseUrl}/admin/errors`} style={link}>
              View all in admin →
            </a>
          </Text>
          <Text style={footerNote}>
            Hourly digest · production only · no email sent when there are no new errors.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export const template = {
  component: ErrorDigestEmail,
  subject: (data: Record<string, any>) =>
    `[Gradus errors] ${data.totalErrors ?? 0} error${
      (data.totalErrors ?? 0) === 1 ? "" : "s"
    } in ${data.totalGroups ?? 0} group${(data.totalGroups ?? 0) === 1 ? "" : "s"} — ${
      data.windowLabel ?? "last hour"
    }`,
  displayName: "Error digest (hourly)",
} satisfies TemplateEntry;

const main: React.CSSProperties = {
  backgroundColor: "#ffffff",
  fontFamily: fonts.body,
  margin: 0,
  padding: "32px 0",
  color: colors.ink,
};
const container: React.CSSProperties = {
  width: "100%",
  maxWidth: "620px",
  margin: "0 auto",
  padding: "24px 28px",
};
const kicker: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: colors.meta,
  margin: 0,
};
const h1: React.CSSProperties = {
  fontFamily: fonts.display,
  fontSize: 26,
  lineHeight: 1.15,
  margin: "8px 0 6px",
  color: colors.ink,
};
const intro: React.CSSProperties = {
  fontSize: 14,
  color: colors.meta,
  margin: "0 0 20px",
};
const card: React.CSSProperties = {
  border: `1px solid ${colors.hair}`,
  borderRadius: 12,
  padding: "14px 16px",
  background: colors.paper,
  marginBottom: 12,
};
const countPill: React.CSSProperties = {
  display: "inline-block",
  fontSize: 12,
  fontWeight: 700,
  color: colors.ink,
  background: "#FEE2E2",
  padding: "2px 8px",
  borderRadius: 999,
  margin: 0,
};
const sourcePill: React.CSSProperties = {
  display: "inline-block",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: colors.meta,
  background: "#E5E7EB",
  padding: "2px 8px",
  borderRadius: 999,
  margin: 0,
};
const groupMsg: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: colors.ink,
  margin: "8px 0 6px",
  lineHeight: 1.4,
};
const groupMeta: React.CSSProperties = {
  fontSize: 12,
  color: colors.meta,
  margin: "2px 0",
  lineHeight: 1.4,
};
const metaLabel: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: colors.meta,
  marginRight: 4,
};
const mono: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 11,
  color: colors.ink,
};
const footerMeta: React.CSSProperties = {
  fontSize: 12,
  color: colors.meta,
  margin: 0,
};
const footerNote: React.CSSProperties = {
  fontSize: 11,
  color: colors.meta,
  margin: "8px 0 0",
};
const link: React.CSSProperties = {
  color: colors.penInk,
  fontWeight: 700,
  textDecoration: "underline",
};
