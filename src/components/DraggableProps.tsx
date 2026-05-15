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
 * The wrapper takes the same positioning + size as the phone container so
 * each prop is sized as a % of the phone (and the defaults stay anchored
 * to the phone when the user changes layout). Drag offsets are applied as
 * translate(), so they compose with the default top/right/bottom/left.
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
  rotate?: number; // baseline rotation in degrees
  z?: number;      // sub-stacking within the props (all are below the phone)
}

interface Props {
  /** Pass the phone container's positioning so this wrapper matches. */
  wrapperStyle: React.CSSProperties;
}

const PROPS: PropDef[] = [
  // Atlas — top, peeks past the right edge of the phone. Big and tilted.
  {
    id: 'atlas',
    src: '/props/travel-atlas.png',
    top: '-12%',
    right: '-38%',
    width: '78%',
    rotate: 12,
    z: 2,
  },
  // Tickets + folded map — bottom-left, peeks out the lower-left of the phone.
  {
    id: 'tickets',
    src: '/props/travel-ticket-map.png',
    bottom: '-2%',
    left: '-46%',
    width: '76%',
    rotate: -10,
    z: 3,
  },
  // Globe — bottom-right, peeks past the right edge. Large + slight tilt.
  {
    id: 'globe',
    src: '/props/travel-globe.png',
    bottom: '-2%',
    right: '-42%',
    width: '58%',
    rotate: -4,
    z: 1,
  },
];

export default function DraggableProps({ wrapperStyle }: Props) {
  // Match the phone position exactly. z-index 3 → behind phone (z=5) and
  // behind the front canvas (z=6) but above the back canvas (z=1).
  return (
    <div
      style={{
        ...wrapperStyle,
        zIndex: 3,
        pointerEvents: 'none', // wrapper itself doesn't intercept; children re-enable
      }}
      aria-hidden="true"
    >
      {PROPS.map(p => (
        <DraggableProp key={p.id} def={p} />
      ))}
    </div>
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
    <img
      src={def.src}
      alt=""
      draggable={false}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: 'absolute',
        top: def.top,
        right: def.right,
        bottom: def.bottom,
        left: def.left,
        width: def.width,
        height: 'auto',
        // translate first (drag offset), then rotate for baseline tilt.
        // No animation while dragging so it feels physical; soft transition
        // back to rest when released.
        transform: `translate(${offset.x}px, ${offset.y}px) rotate(${def.rotate ?? 0}deg)`,
        transition: dragging
          ? 'none'
          : 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)',
        cursor: dragging ? 'grabbing' : 'grab',
        pointerEvents: 'auto',
        touchAction: 'none',
        userSelect: 'none',
        zIndex: def.z ?? 1,
        filter:
          'drop-shadow(0 14px 24px rgba(0,0,0,0.18)) drop-shadow(0 4px 8px rgba(0,0,0,0.12))',
        // Tiny hover lift so it feels grabbable
        willChange: 'transform',
      }}
    />
  );
}
