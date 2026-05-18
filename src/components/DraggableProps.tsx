import { useRef, useState } from 'react';

/* ---------------------------------------------------------------------------
 * Paper-shuffle sound — short noise burst put through a couple of bandpasses
 * with a fast amplitude-envelope chatter so it reads as crinkling paper /
 * map-folding rather than a static hiss. Pure Web Audio, no assets.
 * Triggered on pointer-down of any prop so the click feels tactile.
 * ------------------------------------------------------------------------- */
function playPaperShuffle() {
  try {
    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new AudioCtx();
    const t0 = ctx.currentTime;
    const dur = 0.32;

    // Base noise buffer
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Crinkle chatter: random spikes mixed with mid-amplitude noise + a few
    // sub-bursts so it reads as multiple sheets sliding rather than smooth hiss.
    for (let i = 0; i < data.length; i++) {
      const base = (Math.random() * 2 - 1) * 0.55;
      const chatter = Math.random() > 0.92 ? (Math.random() * 2 - 1) * 0.9 : 0;
      data[i] = base + chatter;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    // High-pass to drop the boomy low end (paper is bright).
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    hp.Q.value = 0.6;

    // Bandpass that sweeps slightly down to suggest "unfolding".
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(3800, t0);
    bp.frequency.exponentialRampToValueAtTime(1900, t0 + dur * 0.9);

    // Amplitude envelope: fast attack, fast-ish decay so it's snappy.
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.34, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.07, t0 + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(hp);
    hp.connect(bp);
    bp.connect(gain);
    gain.connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + dur);

    // A very short "tap" tick on top — gives the gesture a tactile onset.
    const tick = ctx.createOscillator();
    tick.type = 'square';
    tick.frequency.setValueAtTime(2400, t0);
    tick.frequency.exponentialRampToValueAtTime(900, t0 + 0.04);
    const tickGain = ctx.createGain();
    tickGain.gain.setValueAtTime(0.0001, t0);
    tickGain.gain.exponentialRampToValueAtTime(0.05, t0 + 0.005);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
    tick.connect(tickGain);
    tickGain.connect(ctx.destination);
    tick.start(t0);
    tick.stop(t0 + 0.08);

    setTimeout(() => ctx.close(), (dur + 0.1) * 1000);
  } catch {
    // Silent fail — audio just won't play.
  }
}

/**
 * DraggableProps — three travel-themed 3D assets that sit BEHIND the phone
 * (z-index below it) and can be individually click-and-dragged anywhere on
 * screen. Default layout matches the reference:
 *
 *   - Atlas: peeks out from the top-right of the phone
 *   - Tickets + folded map: bottom-left of the phone
 *   - Globe: bottom-right of the phone
 *
 * Entrance animation — each prop appears AFTER the phone has loaded in,
 * sliding outward from behind the phone (initial position pulled toward
 * wrapper center) and rotating from 0° to its rest tilt (3-10°). Opacity
 * fades in alongside the move. Once the entrance finishes, each prop is
 * fully draggable: pointer-events captured, translate offsets compose
 * cleanly with the baseline rotate.
 */

interface PropDef {
  id: string;
  src: string;
  // Default anchors — percentages of the wrapper (which matches the phone).
  // Negative values intentionally let the asset peek outside the phone bounds.
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  width: string;   // as a % of the wrapper width
  rotate?: number; // rest rotation in degrees (3-10 range per spec)
  z?: number;      // sub-stacking within the props (all are below the phone)
  /** When true, this prop renders IN FRONT of the phone instead of behind
   *  it. Used for the globe so it overlaps the phone screen visually. */
  front?: boolean;
  // Entrance — translate from these offsets back to (0, 0) on mount.
  // Pick a direction that points TOWARD the wrapper center, so the prop
  // looks like it slides out from behind the phone.
  enterX: string;
  enterY: string;
  /** ms delay before the entrance keyframe starts. */
  enterDelay: number;
}

interface Props {
  /** Pass the phone container's positioning so this wrapper matches. */
  wrapperStyle: React.CSSProperties;
  /** When true, each prop reverses its entrance — fades out and slides back
   *  toward the wrapper (phone) center. Used while orbs are on screen so the
   *  composition stays clean. */
  hidden?: boolean;
}

// Phone has a 400ms blur-in delay + 1.05s duration. Props start staggered
// after the phone has mostly settled.
const ENTER_BASE_DELAY = 950;

const PROPS: PropDef[] = [
  // Atlas — top, peeks past the right edge of the phone.
  {
    id: 'atlas',
    src: '/props/travel-atlas.png',
    top: '-12%',
    right: '-38%',
    width: '78%',
    rotate: 8,
    z: 2,
    enterX: '-22%',  // start displaced toward wrapper center (down-left from top-right rest)
    enterY: '18%',
    enterDelay: ENTER_BASE_DELAY,
  },
  // Tickets + folded map — bottom-left, peeks out the lower-left of the phone.
  // Hero prop — sized large so it's clearly the focal piece (106% → 138%,
  // another +30% bump on top of the original 40% upsize).
  {
    id: 'tickets',
    src: '/props/travel-ticket-map.png',
    bottom: '-2%',
    left: '-46%',
    width: '138%',
    rotate: -7,
    z: 3,
    enterX: '26%',   // start displaced toward wrapper center (up-right from bottom-left rest)
    enterY: '-14%',
    enterDelay: ENTER_BASE_DELAY + 180,
  },
  // Globe — bottom-right, peeks past the right edge. Renders IN FRONT of
  // the phone so it visually overlaps the screen content.
  {
    id: 'globe',
    src: '/props/travel-globe.png',
    bottom: '-2%',
    right: '-42%',
    width: '58%',
    rotate: -5,
    z: 1,
    front: true,
    enterX: '-24%',  // start displaced toward wrapper center (up-left from bottom-right rest)
    enterY: '-12%',
    enterDelay: ENTER_BASE_DELAY + 360,
  },
];

export default function DraggableProps({ wrapperStyle, hidden = false }: Props) {
  return (
    <>
      <style>{`
        @keyframes dp-enter {
          0% {
            opacity: 0;
            transform:
              translate(var(--enter-x, 0), var(--enter-y, 0))
              scale(0.86);
          }
          100% {
            opacity: 1;
            transform: translate(0, 0) scale(1);
          }
        }
        .dp-enter {
          animation: dp-enter 1.05s cubic-bezier(0.22, 1, 0.36, 1) both;
          will-change: opacity, transform;
        }
        /* Reverse-entrance: prop slides back toward the wrapper center and
           fades out, mirroring the load-in. Used while the orbs are on
           screen so the composition isn't crowded. */
        .dp-wrap {
          transition:
            opacity 0.55s cubic-bezier(0.22, 1, 0.36, 1),
            transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
        }
        /* IMPORTANT: !important + animation:none is required because the
           dp-enter keyframes use fill-mode: both, which otherwise pins the
           opacity/transform to their end-state and blocks .is-hidden. */
        .dp-wrap.is-hidden {
          animation: none !important;
          opacity: 0 !important;
          transform: translate(var(--enter-x, 0), var(--enter-y, 0)) scale(0.86) !important;
          pointer-events: none !important;
        }
        @media (prefers-reduced-motion: reduce) {
          .dp-enter { animation: none !important; }
          .dp-wrap  { transition: none !important; }
        }
      `}</style>
      {/* BACK layer — props that sit BEHIND the phone (zIndex 3, below the
          phone at 5). Atlas + tickets+map live here. */}
      <div
        style={{
          ...wrapperStyle,
          zIndex: 3,
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      >
        {PROPS.filter(p => !p.front).map(p => (
          <DraggableProp key={p.id} def={p} hidden={hidden} />
        ))}
      </div>
      {/* FRONT layer — props that overlap the phone screen (zIndex 6, above
          the phone at 5). Globe lives here so it reads as a 3D object
          drifting over the device. */}
      <div
        style={{
          ...wrapperStyle,
          zIndex: 6,
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      >
        {PROPS.filter(p => p.front).map(p => (
          <DraggableProp key={p.id} def={p} hidden={hidden} />
        ))}
      </div>
    </>
  );
}

function DraggableProp({ def, hidden }: { def: PropDef; hidden: boolean }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; base: { x: number; y: number } } | null>(null);
  const [dragging, setDragging] = useState(false);
  // Hover state — only used to apply a 10% scale + small extra tilt when the
  // cursor is on the prop and the user isn't currently dragging it.
  const [hover, setHover] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, base: offset };
    setDragging(true);
    // Tactile crinkle on pickup — sounds like sliding a map or ticket.
    playPaperShuffle();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setOffset({ x: dragRef.current.base.x + dx, y: dragRef.current.base.y + dy });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!dragRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDragging(false);
  };

  // Compose transform: drag offset + base rotate + (on hover, +scale & nudge
  // the rotation a few degrees in the OPPOSITE direction of the rest tilt so
  // it reads as a playful "lift").
  const baseRot = def.rotate ?? 0;
  const hoverNudgeDeg = baseRot >= 0 ? -6 : 6; // counter-rotate by ~6deg on hover
  const rot = hover && !dragging ? baseRot + hoverNudgeDeg : baseRot;
  const scale = hover && !dragging ? 1.1 : 1;

  return (
    <div
      className={`dp-enter dp-wrap${hidden ? ' is-hidden' : ''}`}
      style={{
        position: 'absolute',
        top: def.top,
        right: def.right,
        bottom: def.bottom,
        left: def.left,
        width: def.width,
        ['--enter-x' as any]: def.enterX,
        ['--enter-y' as any]: def.enterY,
        animationDelay: `${def.enterDelay}ms`,
        zIndex: def.z ?? 1,
      }}
    >
      <img
        src={def.src}
        alt=""
        draggable={false}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rot}deg) scale(${scale})`,
          transformOrigin: 'center center',
          transition: dragging
            ? 'none'
            : 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)',
          cursor: dragging ? 'grabbing' : 'grab',
          pointerEvents: 'auto',
          touchAction: 'none',
          userSelect: 'none',
          // 30% lighter than before (0.18 → 0.126, 0.12 → 0.084) so the
          // shadows still anchor the props but don't feel heavy.
          filter:
            'drop-shadow(0 14px 24px rgba(0,0,0,0.126)) drop-shadow(0 4px 8px rgba(0,0,0,0.084))',
          willChange: 'transform',
        }}
      />
    </div>
  );
}
