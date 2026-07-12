import * as React from "react";
import { Hr, Text } from "@react-email/components";
import { topRule, wordmark, wordmarkHighlight, pageInner, pageInnerBottom } from "./_styles";

/**
 * Shared "letterhead" for every Gradus email: centered serif wordmark with a
 * lime pen-highlight stripe behind it, followed by a full-width hairline rule.
 * Wrap the body content in <PageInner> so the wordmark stays flush with the
 * paper edges while the body has comfortable side padding.
 */
export const Header = () => (
  <>
    <div style={pageInner}>
      <Text style={wordmark}>
        <span style={wordmarkHighlight}>Gradus</span>
      </Text>
    </div>
    <Hr style={topRule} />
  </>
);

export const PageInner: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={pageInner}>{children}</div>
);

export const PageInnerBottom: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={pageInnerBottom}>{children}</div>
);
