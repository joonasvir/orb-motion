/**
 * HoverSpiral — full-viewport SVG overlay that reveals on hover.
 *
 * Renders several curving paths (Bezier arcs) across the page, each carrying
 * one phrase rendered with <textPath>. They fade in + draw out using
 * stroke-dasharray on the path, so each phrase appears to write itself along
 * its arc. The overall effect is a constellation of handwritten thoughts
 * curling around the headline.
 *
 * Pointer-events: none — never blocks interaction with what's underneath.
 */

export interface SpiralPhrase {
  id: string;
  text: string;
  /** SVG path "d" describing the arc the text should follow. Use the
      1920×1080 viewBox below — coordinates are in design units, the SVG
      auto-scales to the viewport via preserveAspectRatio. */
  d: string;
  /** Delay before this phrase starts revealing (ms). */
  delay?: number;
  /** Optional rotation in degrees, applied around the path's bbox center. */
  rotate?: number;
  /** Visual style overrides. */
  fontSize?: number;
  opacity?: number;
}

interface Props {
  visible: boolean;
  phrases?: SpiralPhrase[];
}

// Default phrases following arcs around the page. Coordinates are in a
// 1920×1080 design canvas — the SVG preserves aspect ratio and scales the
// paths to whatever viewport size the page actually renders at.
const DEFAULT_PHRASES: SpiralPhrase[] = [
  {
    id: 'a',
    text: 'for tracking how often I actually check in on my mom',
    d: 'M 60 760 Q 220 540 410 480 T 760 520',
    delay: 0,
  },
  {
    id: 'b',
    text: 'that remembers every coffee order from the people in my life',
    d: 'M 1860 220 Q 1640 320 1480 460 T 1240 720',
    delay: 120,
  },
  {
    id: 'c',
    text: "that knows when the bakery closes on Sundays and warns me at noon",
    d: 'M 130 240 Q 360 120 640 160 T 1080 320',
    delay: 240,
  },
  {
    id: 'd',
    text: 'for the photos from our trip last summer, sorted by who I love',
    d: 'M 1820 900 Q 1500 940 1240 880 T 820 940',
    delay: 360,
  },
  {
    id: 'e',
    text: 'for the inside jokes only my best friend would ever get',
    d: 'M 220 980 Q 540 1060 880 1000 T 1300 1040',
    delay: 480,
  },
];

export default function HoverSpiral({ visible, phrases = DEFAULT_PHRASES }: Props) {
  return (
    <>
      <style>{`
        @keyframes hs-draw {
          0%   { stroke-dashoffset: 1; opacity: 0; }
          15%  { opacity: 1; }
          100% { stroke-dashoffset: 0; opacity: 1; }
        }
        .hs-svg {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100vh;
          pointer-events: none;
          z-index: 25;
          opacity: 0;
          transition: opacity 0.4s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .hs-svg[data-visible="true"] {
          opacity: 1;
        }
        .hs-path {
          fill: none;
          stroke: transparent;
        }
        .hs-text {
          font-family: "Kalice", "Selecta", system-ui, -apple-system, sans-serif;
          font-style: italic;
          fill: rgba(20, 20, 20, 0.62);
          letter-spacing: -0.005em;
        }
        .hs-svg[data-visible="true"] .hs-text {
          animation: hs-draw 1.4s cubic-bezier(0.22, 1, 0.36, 1) both;
          /* The "draw out" trick — the path effectively has a single dash
             the length of itself; offset shrinks from 1 to 0 in pathLength
             units. */
        }
        @media (prefers-reduced-motion: reduce) {
          .hs-svg[data-visible="true"] .hs-text { animation: none; }
        }
      `}</style>
      <svg
        className="hs-svg"
        data-visible={visible}
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          {phrases.map(p => (
            <path key={`def-${p.id}`} id={`hs-path-${p.id}`} className="hs-path" d={p.d} />
          ))}
        </defs>
        {phrases.map(p => (
          <text
            key={`txt-${p.id}`}
            className="hs-text"
            style={{
              animationDelay: `${p.delay ?? 0}ms`,
              fontSize: p.fontSize ?? 24,
              opacity: p.opacity ?? 1,
            }}
            transform={p.rotate ? `rotate(${p.rotate})` : undefined}
          >
            <textPath href={`#hs-path-${p.id}`} startOffset="0">
              {p.text}
            </textPath>
          </text>
        ))}
      </svg>
    </>
  );
}
