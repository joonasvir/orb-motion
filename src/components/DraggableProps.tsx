import { Fragment, useEffect, useRef, useState } from 'react';

/* ---------------------------------------------------------------------------
 * Paper-rustle sound — pure Web Audio synthesis of crinkling paper / tickets
 * sliding. The trick to making this feel like *paper* and not "noise burst":
 *
 *   1. Real paper rustles are a TRAIN of discrete tiny crackles, each only a
 *      few ms long, with random gaps between them. We schedule ~16 short
 *      sub-bursts at randomized times within a 0.45s window instead of one
 *      long continuous noise pulse.
 *   2. Each sub-burst gets its own bandpass center frequency picked from
 *      4–9kHz (paper has lots of high-frequency content; under ~2kHz it
 *      starts sounding like fabric).
 *   3. Per-sub-burst amplitudes are randomized so the listener perceives
 *      multiple separate sheets moving rather than one smooth event.
 *   4. A high-pass filter on the whole chain removes any rumble; a slight
 *      stereo pan keeps consecutive bursts from stacking in the center.
 * ------------------------------------------------------------------------- */
function playPaperShuffle() {
  try {
    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new AudioCtx();
    const t0 = ctx.currentTime;
    const totalDur = 0.45;

    // Master high-pass — kills sub-2kHz rumble so the whole event reads
    // as paper instead of cloth.
    const masterHP = ctx.createBiquadFilter();
    masterHP.type = 'highpass';
    masterHP.frequency.value = 2000;
    masterHP.Q.value = 0.5;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.32;
    masterHP.connect(masterGain);
    masterGain.connect(ctx.destination);

    // One short noise buffer reused by every sub-burst. ~40ms is enough — we
    // just need a chunk of randomness to slice envelopes out of.
    const noiseDur = 0.04;
    const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * noiseDur), ctx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) {
      noiseData[i] = Math.random() * 2 - 1;
    }

    // Schedule ~16 short crackles within the window. Front-load slightly so
    // the gesture has a strong onset, then taper.
    const numCrackles = 16;
    for (let i = 0; i < numCrackles; i++) {
      // Pick a random time in [0, totalDur), but bias EARLY: time = u^1.6 * dur
      const u = Math.random();
      const tCrackle = t0 + Math.pow(u, 1.6) * totalDur;

      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;

      // Per-crackle bandpass — paper-bright band centered 4-9 kHz.
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 6 + Math.random() * 4; // tight Q reads as a discrete crackle
      bp.frequency.value = 4000 + Math.random() * 5000;

      // Tiny envelope: 1-3ms attack, 6-22ms decay. Each crackle is essentially
      // a click with a high-frequency body.
      const g = ctx.createGain();
      const peak = 0.5 + Math.random() * 0.5; // 0.5-1.0
      // Earlier crackles slightly louder for the onset emphasis.
      const earlyBoost = 1 - (tCrackle - t0) / totalDur * 0.4;
      const amp = peak * earlyBoost;
      const attack = 0.001 + Math.random() * 0.002;
      const decay  = 0.006 + Math.random() * 0.016;
      g.gain.setValueAtTime(0.0001, tCrackle);
      g.gain.exponentialRampToValueAtTime(amp, tCrackle + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, tCrackle + attack + decay);

      // Slight stereo pan ([-0.4, +0.4]) so the crackles don't all collapse
      // to mono and start sounding like white noise again.
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) pan.pan.value = (Math.random() * 2 - 1) * 0.4;

      src.connect(bp);
      bp.connect(g);
      if (pan) {
        g.connect(pan);
        pan.connect(masterHP);
      } else {
        g.connect(masterHP);
      }
      // Start the noise source slightly before the envelope opens so the
      // first cycle isn't truncated; stop after the envelope closes.
      src.start(tCrackle);
      src.stop(tCrackle + attack + decay + 0.005);
    }

    setTimeout(() => ctx.close(), (totalDur + 0.15) * 1000);
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
  /** Which persona's prop set to render. 1=travel, 2=travel (fallback),
   *  3=games, 4=travel (fallback). When this changes, the current set
   *  cross-fades out and the new set cross-fades in. */
  personaId?: number;
}

// Phone has a 400ms blur-in delay + 1.05s duration. Props start staggered
// after the phone has mostly settled. Trimmed ~37% (was 950) so the props
// land faster — the previous wait felt sluggish.
const ENTER_BASE_DELAY = 600;

// Travel persona — atlas (top-right), tickets+map (bottom-left hero), globe
// (front, bottom-right). The default scene.
const TRAVEL_PROPS: PropDef[] = [
  {
    id: 'travel-atlas',
    src: '/props/travel-atlas.png',
    top: '-8%',
    right: '-22%',
    width: '50%',
    rotate: 14,
    z: 2,
    enterX: '-18%',
    enterY: '14%',
    enterDelay: ENTER_BASE_DELAY,
  },
  {
    id: 'travel-tickets',
    src: '/props/travel-ticket-map.png',
    bottom: 'calc(-32% + 200px)',
    left: '-58%',
    width: '95%',
    rotate: -22,
    z: 3,
    enterX: '24%',
    enterY: '-16%',
    enterDelay: ENTER_BASE_DELAY + 120,
  },
  {
    id: 'travel-globe',
    src: '/props/travel-globe.png',
    bottom: 'calc(-10% + 200px)',
    right: '-30%',
    width: '36%',
    rotate: -4,
    z: 1,
    front: true,
    enterX: '-20%',
    enterY: '-12%',
    enterDelay: ENTER_BASE_DELAY + 240,
  },
];

// Games persona — play-button arrow (top-right), controller (bottom-left
// hero), pixel cursor (front, bottom-right). Mirrors the travel layout so
// the crossfade reads as a 1:1 scene swap.
const GAMES_PROPS: PropDef[] = [
  {
    id: 'games-play',
    src: '/props/games-play.png',
    top: '-8%',
    right: '-22%',
    width: '46%',
    rotate: 14,
    z: 2,
    enterX: '-18%',
    enterY: '14%',
    enterDelay: ENTER_BASE_DELAY,
  },
  {
    id: 'games-controller',
    src: '/props/games-controller.png',
    bottom: 'calc(-32% + 200px)',
    left: '-58%',
    width: '95%',
    rotate: -22,
    z: 3,
    enterX: '24%',
    enterY: '-16%',
    enterDelay: ENTER_BASE_DELAY + 120,
  },
  {
    id: 'games-cursor',
    src: '/props/games-cursor.png',
    bottom: 'calc(-10% + 200px)',
    right: '-30%',
    width: '34%',
    rotate: -4,
    z: 1,
    front: true,
    enterX: '-20%',
    enterY: '-12%',
    enterDelay: ENTER_BASE_DELAY + 240,
  },
];

// Persona-id → prop-set lookup. Avatars 2 and 4 fall back to travel until
// dedicated sets exist for those personas.
const PROPS_BY_PERSONA: Record<number, PropDef[]> = {
  1: TRAVEL_PROPS,
  2: TRAVEL_PROPS,
  3: GAMES_PROPS,
  4: TRAVEL_PROPS,
};

export default function DraggableProps({ wrapperStyle, hidden = false, personaId = 1 }: Props) {
  // Track current persona + the previous one during a transition. When
  // personaId changes we briefly render BOTH layers — the leaving one
  // fades to opacity 0 while the entering one plays its dp-enter sequence.
  // 360ms after the swap we drop the leaving layer.
  const [layers, setLayers] = useState<Array<{ id: number; personaId: number; state: 'enter' | 'leave' }>>(() => [
    { id: 0, personaId, state: 'enter' },
  ]);
  const nextLayerId = useRef(1);
  const prevPersonaIdRef = useRef(personaId);

  useEffect(() => {
    if (prevPersonaIdRef.current === personaId) return;
    prevPersonaIdRef.current = personaId;
    // Mark all existing layers as leaving and push a new entering layer.
    const id = nextLayerId.current++;
    setLayers(prev => [
      ...prev.map(l => ({ ...l, state: 'leave' as const })),
      { id, personaId, state: 'enter' as const },
    ]);
    // Drop leaving layers after their fade-out completes.
    const t = window.setTimeout(() => {
      setLayers(prev => prev.filter(l => l.state === 'enter'));
    }, 480);
    return () => window.clearTimeout(t);
  }, [personaId]);

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
        /* Persona-swap crossfade: leaving layer fades opacity 1 → 0 over
           ~360ms while the entering layer plays the standard dp-enter
           animation on each of its props (slide-in from behind the phone).
           Both layers are stacked at the same zIndex so they overlap
           cleanly during the transition. */
        .dp-layer {
          transition: opacity 0.36s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .dp-layer--leaving {
          opacity: 0;
          pointer-events: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .dp-enter { animation: none !important; }
          .dp-wrap  { transition: none !important; }
          .dp-layer { transition: none !important; }
        }
      `}</style>
      {/* One <Layer> per active persona, stacked. Most of the time there's
          just the current persona; during a swap we briefly render two. */}
      {layers.map(layer => {
        const persona = PROPS_BY_PERSONA[layer.personaId] ?? PROPS_BY_PERSONA[1];
        const backProps  = persona.filter(p => !p.front);
        const frontProps = persona.filter(p => p.front);
        const layerCls = `dp-layer${layer.state === 'leave' ? ' dp-layer--leaving' : ''}`;
        return (
          <Fragment key={layer.id}>
            {/* BACK layer — props that sit BEHIND the phone (zIndex 3). */}
            <div
              className={layerCls}
              style={{ ...wrapperStyle, zIndex: 3, pointerEvents: 'none' }}
              aria-hidden="true"
            >
              {backProps.map(p => (
                <DraggableProp key={p.id} def={p} hidden={hidden} />
              ))}
            </div>
            {/* FRONT layer — overlaps the phone screen (zIndex 6). */}
            <div
              className={layerCls}
              style={{ ...wrapperStyle, zIndex: 6, pointerEvents: 'none' }}
              aria-hidden="true"
            >
              {frontProps.map(p => (
                <DraggableProp key={p.id} def={p} hidden={hidden} />
              ))}
            </div>
          </Fragment>
        );
      })}
    </>
  );
}

// Drag-and-drop interaction temporarily disabled — props are visual-only
// for now. Flip to `true` to bring back the click-to-drag + paper-rustle
// sound on prop pickup.
const DRAG_ENABLED = false;

function DraggableProp({ def, hidden }: { def: PropDef; hidden: boolean }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; base: { x: number; y: number } } | null>(null);
  const [dragging, setDragging] = useState(false);
  // Hover state — drives the lift-on-hover effect (10% scale + counter-tilt).
  // Kept enabled even with drag disabled so the props still feel interactive.
  const [hover, setHover] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!DRAG_ENABLED) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, base: offset };
    setDragging(true);
    // Tactile crinkle on pickup — sounds like sliding a map or ticket.
    playPaperShuffle();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!DRAG_ENABLED) return;
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setOffset({ x: dragRef.current.base.x + dx, y: dragRef.current.base.y + dy });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!DRAG_ENABLED) return;
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
          cursor: DRAG_ENABLED ? (dragging ? 'grabbing' : 'grab') : 'default',
          // Pointer events still on so the hover lift (scale + tilt) fires.
          // Drag handlers are guarded by the DRAG_ENABLED flag above and
          // no-op when it's off.
          pointerEvents: 'auto',
          touchAction: DRAG_ENABLED ? 'none' : 'auto',
          userSelect: 'none',
          // 30% lighter than before (0.18 → 0.126, 0.12 → 0.084) so the
          // shadows still anchor the props but don't feel heavy.
          filter:
            'drop-shadow(0 14px 24px rgba(0, 0, 0, 0.0882)) drop-shadow(0 4px 8px rgba(0, 0, 0, 0.0588))',
          willChange: 'transform',
        }}
      />
    </div>
  );
}
