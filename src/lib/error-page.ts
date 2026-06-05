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
      .skater-stage {
        position: relative;
        height: 140px;
        width: 180px;
        margin: 0 auto 1.25rem;
      }
      .skater { width: 180px; height: 140px; display: block; }
      .ice { stroke: #9CA3AF; stroke-width: 1.5; stroke-linecap: round; }
      .figure {
        transform-origin: 90px 118px;
        transform-box: fill-box;
        animation: skater-fall 3.4s cubic-bezier(.6,.05,.3,1) infinite;
      }
      .arm-l { transform-origin: 90px 78px; transform-box: fill-box; animation: arm-l 3.4s ease-in-out infinite; }
      .arm-r { transform-origin: 90px 78px; transform-box: fill-box; animation: arm-r 3.4s ease-in-out infinite; }
      .stars { opacity: 0; animation: stars 3.4s ease-out infinite; }

      @keyframes skater-fall {
        0%   { transform: rotate(0deg)   translateY(0); }
        35%  { transform: rotate(-4deg)  translateY(0); }
        45%  { transform: rotate(10deg)  translateY(0); }
        58%  { transform: rotate(82deg)  translateY(6px); }
        78%  { transform: rotate(82deg)  translateY(6px); }
        92%  { transform: rotate(0deg)   translateY(0); }
        100% { transform: rotate(0deg)   translateY(0); }
      }
      @keyframes arm-l {
        0%, 30% { transform: rotate(0deg); }
        40%     { transform: rotate(-55deg); }
        50%     { transform: rotate(30deg); }
        58%, 100% { transform: rotate(0deg); }
      }
      @keyframes arm-r {
        0%, 30% { transform: rotate(0deg); }
        40%     { transform: rotate(55deg); }
        50%     { transform: rotate(-30deg); }
        58%, 100% { transform: rotate(0deg); }
      }
      @keyframes stars {
        0%, 56%   { opacity: 0; transform: translateY(0); }
        60%       { opacity: 1; transform: translateY(-2px); }
        75%       { opacity: 0.6; transform: translateY(-6px); }
        85%, 100% { opacity: 0; transform: translateY(-10px); }
      }
      @media (prefers-reduced-motion: reduce) {
        .figure, .arm-l, .arm-r, .stars { animation: none; }
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
      <div class="skater-stage" aria-hidden="true">
        <svg class="skater" viewBox="0 0 180 140" xmlns="http://www.w3.org/2000/svg">
          <!-- ice surface -->
          <line class="ice" x1="10" y1="124" x2="170" y2="124"/>
          <line class="ice" x1="20" y1="130" x2="80" y2="130" opacity="0.4"/>
          <line class="ice" x1="100" y1="130" x2="160" y2="130" opacity="0.4"/>

          <!-- stars / impact lines (above head when fallen) -->
          <g class="stars" stroke="#6B7280" stroke-width="1.5" stroke-linecap="round" fill="none">
            <path d="M40 70 l4 -4"/>
            <path d="M48 64 l-3 -4"/>
            <path d="M34 60 l5 -2"/>
          </g>

          <!-- the figure: head, body, arms, leg, skate -->
          <g class="figure" fill="none" stroke="#374151" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <!-- head -->
            <circle cx="90" cy="62" r="10" fill="#F5F6FA"/>
            <!-- torso -->
            <line x1="90" y1="72" x2="90" y2="100"/>
            <!-- arms (separate groups so they can windmill) -->
            <g class="arm-l"><line x1="90" y1="78" x2="72" y2="92"/></g>
            <g class="arm-r"><line x1="90" y1="78" x2="108" y2="92"/></g>
            <!-- standing leg -->
            <line x1="90" y1="100" x2="86" y2="118"/>
            <!-- trailing skating leg, extended back -->
            <line x1="90" y1="100" x2="108" y2="114"/>
            <!-- skate blade under standing leg -->
            <line x1="78" y1="120" x2="98" y2="120" stroke="#6B7280" stroke-width="2"/>
          </g>
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
