import * as React from "react";
import { Hr, Img } from "@react-email/components";
import { topRule, pageInner, pageInnerBottom, wordmarkImg, outerBand } from "./_styles";
import wordmarkLight from "@/assets/email-wordmark-light.png.asset.json";

// Email clients require absolute URLs for images. Assets are served by Lovable
// infrastructure at /__l5e/... from any project origin.
const WORDMARK_URL = `https://gradus.training${wordmarkLight.url}`;

/**
 * Shared "letterhead" for every Gradus email: the Gradus wordmark image
 * (dark ink + lime pen-highlight stripe) followed by a full-width hairline
 * rule. Wrap the body content in <PageInner> so the wordmark stays flush
 * with the paper edges while the body has comfortable side padding.
 */
export const Header = () => (
  <>
    <div style={pageInner}>
      <Img src={WORDMARK_URL} alt="Gradus" width="200" style={wordmarkImg} />
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

export const PageShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={outerBand}>{children}</div>
);

