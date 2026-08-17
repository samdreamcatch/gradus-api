// Diagnostics for React hydration mismatches (minified errors #418/#423/#425).
//
// Why this exists: production hydration errors arrive as a bare minified
// message with a mangled stack, which tells us nothing about WHY the server
// HTML and the browser DOM disagreed. Every occurrence we've logged so far is
// an anonymous iOS visitor on a public SSR route (/login, /p/$token), which
// points at the page being rewritten before React hydrates — Safari data
// detectors, on-the-fly translation, or an in-app browser injecting nodes.
//
// This module collects those environment signals AT THE MOMENT the mismatch
// is reported, plus a snapshot taken before hydration by the inline script in
// the root shell. Nothing here changes rendering or user-visible behavior.

/** Marker set on window by the pre-hydration inline script in the root shell. */
export const PRE_HYDRATION_GLOBAL = "__gradusPreHydration";

/**
 * Inline script string for the root shell. Runs before hydration and records
 * a snapshot of the DOM as the browser handed it to us, so we can tell
 * "something rewrote the page" apart from "our render was wrong".
 *
 * Must stay dependency-free, synchronous, and never throw.
 */
export const PRE_HYDRATION_SNAPSHOT_SCRIPT = `(function(){try{var d=document,h=d.documentElement,b=d.body;window.${PRE_HYDRATION_GLOBAL}={t:Date.now(),lang:h.getAttribute('lang'),cls:h.className||'',bodyChildren:b?b.children.length:0,anchors:d.getElementsByTagName('a').length,dd:!!d.querySelector('a[x-apple-data-detectors],a[href^="tel:"],a[href^="x-apple-data-detectors:"]'),font:!!d.querySelector('font'),tclass:/translated|notranslate-|VIcon/.test(h.className),ext:(function(){var n=0,s=d.getElementsByTagName('script');for(var i=0;i<s.length;i++){var u=s[i].src||'';if(u&&u.indexOf(location.origin)!==0)n++;}return n;})()};}catch(e){}})();`;

const HYDRATION_PATTERNS: RegExp[] = [
  /Minified React error #(418|419|421|422|423|425)\b/i,
  /Hydration failed/i,
  /server rendered HTML didn't match/i,
  /Text content does not match server-rendered HTML/i,
  /There was an error while hydrating/i,
];

/** True when the reported error is React telling us SSR output != client DOM. */
export function isHydrationError(message: string): boolean {
  return HYDRATION_PATTERNS.some((re) => re.test(message));
}

const IN_APP_BROWSERS: Array<[RegExp, string]> = [
  [/FBAN|FBAV|FB_IAB/i, "facebook"],
  [/Instagram/i, "instagram"],
  [/Line\//i, "line"],
  [/Snapchat/i, "snapchat"],
  [/MicroMessenger/i, "wechat"],
  [/Twitter|TwitterAndroid/i, "twitter"],
  [/Pinterest/i, "pinterest"],
  [/TikTok|BytedanceWebview/i, "tiktok"],
  [/LinkedInApp/i, "linkedin"],
  [/GSA\//i, "google-app"],
  [/\bWebView\b|; wv\)/i, "generic-webview"],
];

function detectInAppBrowser(ua: string): string | null {
  for (const [re, name] of IN_APP_BROWSERS) {
    if (re.test(ua)) return name;
  }
  return null;
}

/**
 * Signals collected when the mismatch is reported. Deliberately small,
 * boolean-heavy, and free of page content so nothing personal is logged.
 */
export interface HydrationDiagnostics {
  /** Snapshot recorded by the pre-hydration inline script, if it ran. */
  pre?: Record<string, unknown> | null;
  /** Page was (or is being) machine-translated. */
  translated: boolean;
  /** Which translation surface we detected, when we can tell. */
  translationSource: string | null;
  /** iOS data detectors rewrote plain text into links. */
  dataDetectors: boolean;
  /** Non-null when running inside a social/app webview rather than the browser. */
  inAppBrowser: string | null;
  /** Anchor count now vs. before hydration — a jump means the DOM was rewritten. */
  anchorDelta: number | null;
  /** Direct children of <body> now vs. before hydration. */
  bodyChildDelta: number | null;
  /** <font> tags present — the classic fingerprint of Google Translate. */
  fontTags: number;
  /** Scripts loaded from other origins (extension/webview injection). */
  foreignScripts: number;
  /** Current <html lang>, which translators rewrite. */
  lang: string | null;
  /** Whether the document had finished loading when the error fired. */
  readyState: string | null;
  standalone: boolean;
  viewport: string | null;
}

function readPreSnapshot(): Record<string, unknown> | null {
  try {
    const snap = (window as unknown as Record<string, unknown>)[PRE_HYDRATION_GLOBAL];
    return snap && typeof snap === "object" ? (snap as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function collectHydrationDiagnostics(): HydrationDiagnostics | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  try {
    const html = document.documentElement;
    const cls = html.className || "";
    const pre = readPreSnapshot();

    const googleTranslate = !!document.querySelector(
      "font[_mstmutation], font[style*='vertical-align'], .goog-te-banner-frame, #goog-gt-tt, [class*='translated-']",
    );
    const microsoftTranslate = !!document.querySelector("[_msttexthash], [_msthash]");
    const safariTranslate =
      !!html.getAttribute("translate-lang") ||
      (!!pre && typeof pre.lang === "string" && pre.lang !== html.getAttribute("lang"));
    const translationSource = googleTranslate
      ? "google"
      : microsoftTranslate
        ? "microsoft"
        : safariTranslate
          ? "safari-or-lang-change"
          : /translated-(ltr|rtl)/.test(cls)
            ? "class-marker"
            : null;

    const dataDetectors = !!document.querySelector(
      "a[x-apple-data-detectors], a[href^='x-apple-data-detectors:'], a[data-detector]",
    );

    const anchorsNow = document.getElementsByTagName("a").length;
    const bodyChildrenNow = document.body ? document.body.children.length : 0;
    const foreignScripts = Array.from(document.getElementsByTagName("script")).filter((s) => {
      const src = s.getAttribute("src") || "";
      return !!src && !src.startsWith(window.location.origin) && !src.startsWith("/");
    }).length;

    const preAnchors = pre ? num(pre.anchors) : null;
    const preBodyChildren = pre ? num(pre.bodyChildren) : null;

    return {
      pre,
      translated: !!translationSource,
      translationSource,
      dataDetectors: dataDetectors || (!!pre && pre.dd === true),
      inAppBrowser: detectInAppBrowser(navigator.userAgent || ""),
      anchorDelta: preAnchors === null ? null : anchorsNow - preAnchors,
      bodyChildDelta: preBodyChildren === null ? null : bodyChildrenNow - preBodyChildren,
      fontTags: document.getElementsByTagName("font").length,
      foreignScripts,
      lang: html.getAttribute("lang"),
      readyState: document.readyState,
      standalone:
        window.matchMedia?.("(display-mode: standalone)").matches === true ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true,
      viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio || 1}`,
    };
  } catch {
    return null;
  }
}
