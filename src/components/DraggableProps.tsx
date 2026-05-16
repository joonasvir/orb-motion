import { useRef, useState } from 'react';

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
  // 40% larger than the other props by request — reads as the hero prop.
  {
    id: 'tickets',
    src: '/props/travel-ticket-map.png',
    bottom: '-2%',
    left: '-46%',
    width: '106%',
    rotate: -7,
    z: 3,
    enterX: '26%',   // start displaced toward wrapper center (up-right from bottom-left rest)
    enterY: '-14%',
    enterDelay: ENTER_BASE_DELAY + 180,
  },
  // Globe — bottom-right, peeks past the right edge.
  {
    id: 'globe',
    src: '/props/travel-globe.png',
    bottom: '-2%',
    right: '-42%',
    width: '58%',
    rotate: -5,
    z: 1,
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
        .dp-wrap.is-hidden {
          opacity: 0;
          transform: translate(var(--enter-x, 0), var(--enter-y, 0)) scale(0.86);
          pointer-events: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .dp-enter { animation: none !important; }
          .dp-wrap  { transition: none !important; }
        }
      `}</style>
      <div
        style={{
          ...wrapperStyle,
          zIndex: 3,
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      >
        {PROPS.map(p => (
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
