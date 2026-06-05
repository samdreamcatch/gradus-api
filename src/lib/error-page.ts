// Standalone, dependency-free SSR fallback page.
// Survives total app/bundle failure: no external fonts, no CSS imports,
// no JS beyond inline handlers, all colors as raw hex.
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>This page didn't load</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      *, *::before, *::after { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 1.5rem;
        background-color: #F5F6FA;
        background-image:
          /* ruled lines */
          repeating-linear-gradient(
            to bottom,
            transparent 0,
            transparent 31px,
            rgba(31, 41, 55, 0.07) 31px,
            rgba(31, 41, 55, 0.07) 32px
          ),
          /* paper grain */
          url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.12  0 0 0 0 0.16  0 0 0 0 0.22  0 0 0 0.12 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
        color: #1F2937;
        font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .wrap { width: 100%; max-width: 28rem; text-align: center; }
      .ball-stage {
        position: relative;
        height: 96px;
        margin: 0 auto 1.25rem;
        width: 80px;
      }
      .ball {
        position: absolute;
        left: 50%;
        bottom: 14px;
        width: 56px;
        height: 56px;
        margin-left: -28px;
        animation: bounce 1.1s cubic-bezier(.5,0,.5,1) infinite;
      }
      .shadow {
        position: absolute;
        left: 50%;
        bottom: 6px;
        width: 56px;
        height: 10px;
        margin-left: -28px;
        background: radial-gradient(ellipse at center, rgba(31,41,55,0.28) 0%, rgba(31,41,55,0) 70%);
        border-radius: 50%;
        animation: shadow 1.1s cubic-bezier(.5,0,.5,1) infinite;
        transform-origin: center;
      }
      @keyframes bounce {
        0%   { transform: translateY(-60px); }
        50%  { transform: translateY(0); }
        100% { transform: translateY(-60px); }
      }
      @keyframes shadow {
        0%   { transform: scale(0.55); opacity: 0.4; }
        50%  { transform: scale(1);    opacity: 0.9; }
        100% { transform: scale(0.55); opacity: 0.4; }
      }
      @media (prefers-reduced-motion: reduce) {
        .ball, .shadow { animation: none; }
        .ball { transform: translateY(0); }
      }
      .card {
        background: #FFFFFF;
        border-radius: 20px;
        padding: 2rem 1.75rem;
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,0.9),
          0 1px 2px rgba(31,41,55,0.06),
          0 24px 48px -20px rgba(31,41,55,0.18);
      }
      h1 {
        font-family: Georgia, "Times New Roman", serif;
        font-weight: 600;
        font-size: 30px;
        line-height: 1.15;
        letter-spacing: -0.01em;
        margin: 0 0 0.65rem;
        color: #1F2937;
      }
      .hl {
        position: relative;
        display: inline-block;
        padding: 0 0.08em;
      }
      .hl::before {
        content: "";
        position: absolute;
        left: -0.04em;
        right: -0.04em;
        top: 48%;
        height: 46%;
        background: linear-gradient(
          to right,
          rgba(156,163,175,0.85) 0%,
          rgba(156,163,175,0.55) 60%,
          rgba(156,163,175,0.2) 90%,
          transparent 100%
        );
        transform: rotate(-2.5deg);
        transform-origin: left center;
        z-index: 0;
        border-radius: 2px;
      }
      .hl > span { position: relative; z-index: 1; }
      p { color: #6B7280; margin: 0 0 1.5rem; }
      .actions {
        display: flex;
        gap: 0.5rem;
        justify-content: center;
        flex-wrap: wrap;
      }
      a, button {
        font: inherit;
        cursor: pointer;
        padding: 0.6rem 1.1rem;
        border-radius: 9999px;
        text-decoration: none;
        border: 1px solid transparent;
        transition: filter 0.15s ease, transform 0.15s ease;
      }
      .primary {
        background: #6B7280;
        color: #FFFFFF;
        font-weight: 700;
        box-shadow: 0 1px 0 rgba(255,255,255,0.2) inset, 0 4px 12px -4px rgba(31,41,55,0.35);
      }
      .primary:hover { filter: brightness(0.96); }
      .primary:active { transform: translateY(1px); }
      .secondary {
        background: #FFFFFF;
        color: #1F2937;
        border-color: #E6E7EB;
      }
      .secondary:hover { background: #F8F9FC; }
      :focus-visible { outline: 2px solid #6B7280; outline-offset: 3px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="ball-stage" aria-hidden="true">
        <div class="shadow"></div>
        <svg class="ball" viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="bg" cx="35%" cy="32%" r="70%">
              <stop offset="0%" stop-color="#D1D5DB"/>
              <stop offset="60%" stop-color="#9CA3AF"/>
              <stop offset="100%" stop-color="#6B7280"/>
            </radialGradient>
          </defs>
          <circle cx="28" cy="28" r="26" fill="url(#bg)" stroke="#1F2937" stroke-opacity="0.15" stroke-width="1"/>
          <path d="M6 18 Q28 30 50 18" fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" opacity="0.9"/>
          <path d="M6 38 Q28 26 50 38" fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" opacity="0.9"/>
        </svg>
      </div>
      <div class="card">
        <h1>This page didn't <span class="hl"><span>load</span></span></h1>
        <p>Something went wrong on our end. You can try refreshing or head back home.</p>
        <div class="actions">
          <button class="primary" onclick="location.reload()">Try again</button>
          <a class="secondary" href="/">Go home</a>
        </div>
      </div>
    </div>
  </body>
</html>`;
}
