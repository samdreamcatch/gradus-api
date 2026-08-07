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
        height: 180px;
        width: 240px;
        margin: 0 auto 1.25rem;
      }
      .skater { width: 240px; height: 180px; display: block; }
      .ice { stroke: #9CA3AF; stroke-width: 1.5; stroke-linecap: round; fill: none; }
      .stroke { stroke: #374151; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; fill: none; }
      .head { fill: none; stroke: #374151; stroke-width: 3; }
      .blade { stroke: #6B7280; stroke-width: 2.5; stroke-linecap: round; }

      /* Glide in from the left */
      .scene { animation: scene 6s cubic-bezier(.5,.05,.45,1) infinite; }
      @keyframes scene {
        0%   { transform: translateX(-100px); }
        20%  { transform: translateX(0); }
        100% { transform: translateX(0); }
      }
      /* Tip over from the skate */
      .figure {
        transform-box: fill-box;
        transform-origin: 50% 100%;
        animation: figure 6s cubic-bezier(.6,.02,.35,1) infinite;
      }
      @keyframes figure {
        0%, 40%  { transform: rotate(0deg); }
        55%, 90% { transform: rotate(-82deg); }
        100%     { transform: rotate(0deg); }
      }
      .arm-l { transform-box: fill-box; transform-origin: 100% 0%; animation: arm-l 6s linear infinite; }
      .arm-r { transform-box: fill-box; transform-origin: 0% 0%;   animation: arm-r 6s linear infinite; }
      @keyframes arm-l {
        0%, 20%   { transform: rotate(20deg); }
        25%       { transform: rotate(-40deg); }
        30%       { transform: rotate(-120deg); }
        35%       { transform: rotate(-40deg); }
        40%       { transform: rotate(30deg); }
        55%, 100% { transform: rotate(70deg); }
      }
      @keyframes arm-r {
        0%, 20%   { transform: rotate(-20deg); }
        25%       { transform: rotate(40deg); }
        30%       { transform: rotate(120deg); }
        35%       { transform: rotate(40deg); }
        40%       { transform: rotate(-30deg); }
        55%, 100% { transform: rotate(-70deg); }
      }
      .leg-free { transform-box: fill-box; transform-origin: 0% 0%; animation: legf 6s ease-in-out infinite; }
      @keyframes legf {
        0%, 20%   { transform: rotate(0deg); }
        30%       { transform: rotate(-25deg); }
        40%       { transform: rotate(-10deg); }
        55%, 100% { transform: rotate(35deg); }
      }
      @media (prefers-reduced-motion: reduce) {
        .scene, .figure, .arm-l, .arm-r, .leg-free { animation: none; }
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
        <svg class="skater" viewBox="0 0 280 220" xmlns="http://www.w3.org/2000/svg">
          <!-- ice surface -->
          <line class="ice" x1="0" y1="200" x2="280" y2="200"/>
          <path class="ice" d="M30 196 q40 -6 80 0 M150 196 q40 -6 80 0" opacity="0.45"/>

          <g transform="translate(140 200)">
            <g class="scene">
              <g class="figure">
                <!-- skating leg -->
                <line class="stroke" x1="0" y1="0" x2="0" y2="-50"/>
                <!-- skating blade -->
                <line class="blade" x1="-8" y1="0" x2="10" y2="0"/>

                <!-- free leg -->
                <g transform="translate(0 -50)">
                  <g class="leg-free">
                    <line class="stroke" x1="0" y1="0" x2="14" y2="36"/>
                    <line class="blade" x1="9" y1="36" x2="22" y2="38"/>
                  </g>
                </g>

                <!-- torso -->
                <line class="stroke" x1="0" y1="-50" x2="0" y2="-95"/>

                <!-- arms -->
                <g transform="translate(0 -92)">
                  <g class="arm-l">
                    <line class="stroke" x1="0" y1="0" x2="-22" y2="22"/>
                  </g>
                </g>
                <g transform="translate(0 -92)">
                  <g class="arm-r">
                    <line class="stroke" x1="0" y1="0" x2="22" y2="22"/>
                  </g>
                </g>

                <!-- head -->
                <circle class="head" cx="0" cy="-106" r="11"/>
              </g>
            </g>
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
