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
  {
    id: 'tickets',
    src: '/props/travel-ticket-map.png',
    bottom: '-2%',
    left: '-46%',
    width: '76%',
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

export default function DraggableProps({ wrapperStyle }: Props) {
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
        @media (prefers-reduced-motion: reduce) {
          .dp-enter { animation: none !important; }
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
          <DraggableProp key={p.id} def={p} />
        ))}
      </div>
    </>
  );
}

function DraggableProp({ def }: { def: PropDef }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; base: { x: number; y: number } } | null>(null);
  const [dragging, setDragging] = useState(false);

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

  return (
    <div
      className="dp-enter"
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
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          transform: `translate(${offset.x}px, ${offset.y}px) rotate(${def.rotate ?? 0}deg)`,
          transition: dragging
            ? 'none'
            : 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)',
          cursor: dragging ? 'grabbing' : 'grab',
          pointerEvents: 'auto',
          touchAction: 'none',
          userSelect: 'none',
          filter:
            'drop-shadow(0 14px 24px rgba(0,0,0,0.18)) drop-shadow(0 4px 8px rgba(0,0,0,0.12))',
          willChange: 'transform',
        }}
      />
    </div>
  );
}
