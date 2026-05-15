import { useEffect, useRef, useState } from 'react';
import type { HandLandmarker } from '@mediapipe/tasks-vision';

/**
 * HandControl — laptop camera → orb gestures.
 *
 * What it does when `enabled` is true:
 *  1. Asks the browser for camera permission (front-facing user camera).
 *  2. Spins up MediaPipe HandLandmarker (WASM + GPU), tracking up to 2 hands.
 *  3. Each frame, derives:
 *      - hand center (normalized 0..1, x-flipped to feel like a mirror),
 *      - open/fist gesture,
 *      - inter-hand distance (for clap detection),
 *      - hand center velocity.
 *  4. Reports up via callbacks. The parent (App.tsx) wires those to the same
 *     levers the joystick / mouse already drive: mouseTilt parallax, mode
 *     switch (physics ↔ cyclone), and the lever toggle on clap.
 *  5. Renders a small mirrored preview in the bottom-right corner.
 *
 * Gestures (simple-and-cheap, no separate gesture model):
 *  - **fist**: every fingertip is closer to the wrist than the corresponding
 *    knuckle is. Fingers are curled in.
 *  - **open**: every fingertip is farther from the wrist than the corresponding
 *    knuckle. Hand is splayed.
 *  - anything else: `null` (transitional, partial — ignored to avoid flicker).
 *
 * Clap detection:
 *  - Both hands must be visible.
 *  - Inter-hand center distance crossed below CLAP_THRESHOLD in the last frame.
 *  - Approach velocity (rate of distance decrease) above APPROACH_VEL.
 *  - 700ms cooldown so a single clap fires once.
 */

export type HandGesture = 'open' | 'fist' | null;

interface HandControlProps {
  enabled: boolean;
  /** Fires once per clap. */
  onClap?: () => void;
  /** Normalized 0..1 position of the dominant hand center (null when nothing seen). */
  onHandPosition?: (pos: { x: number; y: number } | null) => void;
  /** Current gesture of the dominant hand. Fires only when it changes. */
  onGesture?: (g: HandGesture) => void;
  /** Continuous palm height (0=top, 1=bottom) while an open palm is visible.
      null when no open palm is detected. Drives the cyclone radius. */
  onPalmHeight?: (y: number | null) => void;
  /** Whether the small preview should be visible. */
  showPreview?: boolean;
  /** Reports loading/error state up so the panel can show "Loading…" / "Denied". */
  onStatus?: (s: 'loading' | 'ready' | 'denied' | 'error' | 'off') => void;
  /** Preview size preset for "normal" mode. (Ignored in split/mini.) */
  size?: 's' | 'm' | 'l' | 'xl';
  /** Render the live skeleton (landmarks + connections) on top of the video. */
  showSkeleton?: boolean;
  /** Layout mode for the preview. */
  layoutMode?: 'normal' | 'split' | 'mini';
  /** Which side the webcam occupies when in split mode. */
  splitSide?: 'left' | 'right';
  onChangeLayoutMode?: (m: 'normal' | 'split' | 'mini') => void;
  onChangeSplitSide?: (s: 'left' | 'right') => void;
}

// MediaPipe's canonical hand-skeleton connections (21 landmarks).
// See: https://developers.google.com/mediapipe/solutions/vision/hand_landmarker
const HAND_CONNECTIONS: Array<[number, number]> = [
  // thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // middle
  [5, 9], [9, 10], [10, 11], [11, 12],
  // ring
  [9, 13], [13, 14], [14, 15], [15, 16],
  // pinky
  [13, 17], [17, 18], [18, 19], [19, 20],
  // palm baseline
  [0, 17],
];

const PREVIEW_SIZES = {
  s:  { w: 192, h: 144 },
  m:  { w: 288, h: 216 },
  l:  { w: 416, h: 312 },
  xl: { w: 576, h: 432 },
} as const;

// Use a CDN host for the WASM bundle so we don't have to bundle it ourselves.
// Pinned major version to avoid surprise breakage.
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Tuning knobs ------------------------------------------------------------
const CLAP_THRESHOLD = 0.18;   // hands "touching" in normalized units
const APPROACH_VEL   = 0.35;   // distance decrease per frame to count as a clap
const CLAP_COOLDOWN  = 700;    // ms — debounce so one clap fires once
const POSITION_LERP  = 0.35;   // smoothing on hand center reports

// Landmark indices that MediaPipe's hand model uses.
// Reference: https://developers.google.com/mediapipe/solutions/vision/hand_landmarker
const WRIST = 0;
const FINGERTIPS = [4, 8, 12, 16, 20];   // thumb, index, middle, ring, pinky
const KNUCKLES   = [2, 5, 9, 13, 17];

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function classifyGesture(landmarks: Array<{ x: number; y: number }>): HandGesture {
  const wrist = landmarks[WRIST];
  let openCount = 0;
  let fistCount = 0;
  for (let i = 0; i < 5; i++) {
    const tip = landmarks[FINGERTIPS[i]];
    const knuckle = landmarks[KNUCKLES[i]];
    if (!tip || !knuckle) return null;
    const dTip = dist(tip, wrist);
    const dKnuckle = dist(knuckle, wrist);
    if (dTip > dKnuckle * 1.25) openCount += 1;
    else if (dTip < dKnuckle * 0.95) fistCount += 1;
  }
  if (openCount >= 4) return 'open';
  if (fistCount >= 4) return 'fist';
  return null;
}

export default function HandControl({
  enabled,
  onClap,
  onHandPosition,
  onGesture,
  onPalmHeight,
  showPreview = true,
  onStatus,
  size = 'l',
  showSkeleton = true,
  layoutMode = 'normal',
  splitSide = 'right',
  onChangeLayoutMode,
  onChangeSplitSide,
}: HandControlProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const lastResultsRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);

  // Per-frame state held in refs so the rAF loop sees the latest values.
  const lastHandsRef = useRef<{ centers: Array<{ x: number; y: number }>; distance: number } | null>(null);
  const lastClapAtRef = useRef(0);
  const smoothedPosRef = useRef<{ x: number; y: number } | null>(null);
  const lastGestureRef = useRef<HandGesture>(null);
  const lastPalmHeightReportedRef = useRef(false);

  const [status, setStatus] = useState<'off' | 'loading' | 'ready' | 'denied' | 'error'>('off');

  // Keep latest callback refs so the rAF loop doesn't capture stale closures.
  const cbsRef = useRef({
    onClap, onHandPosition, onGesture, onPalmHeight,
    size, showSkeleton,
  });
  cbsRef.current = {
    onClap, onHandPosition, onGesture, onPalmHeight,
    size, showSkeleton,
  };

  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        setStatus('loading');

        // 1) MediaPipe init (downloads WASM + the .task model first time only).
        //    Dynamic import → MediaPipe lives in its own chunk and only ships
        //    when the user actually flips Hand control on.
        const { FilesetResolver, HandLandmarker: HL } = await import('@mediapipe/tasks-vision');
        if (cancelled) return;
        const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
        if (cancelled) return;
        const landmarker = await HL.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;

        // 2) Camera permission + stream.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 640, height: 480 },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();

        setStatus('ready');

        // 3) rAF detect loop.
        const detect = () => {
          if (cancelled || !landmarkerRef.current || !videoRef.current) return;
          const v = videoRef.current;
          if (v.readyState >= 2 && v.currentTime !== lastVideoTimeRef.current) {
            lastVideoTimeRef.current = v.currentTime;
            const ts = performance.now();
            const results = landmarkerRef.current.detectForVideo(v, ts);
            lastResultsRef.current = results;
            handleResults(results);
          }
          drawOverlay();
          rafRef.current = requestAnimationFrame(detect);
        };
        rafRef.current = requestAnimationFrame(detect);
      } catch (err: any) {
        if (cancelled) return;
        const denied =
          err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
        setStatus(denied ? 'denied' : 'error');
        // eslint-disable-next-line no-console
        console.warn('[HandControl] init failed:', err);
      }
    }

    function handleResults(results: any) {
      const handLandmarks = (results?.landmarks ?? []) as Array<Array<{ x: number; y: number }>>;

      if (handLandmarks.length === 0) {
        cbsRef.current.onHandPosition?.(null);
        if (lastGestureRef.current !== null) {
          lastGestureRef.current = null;
          cbsRef.current.onGesture?.(null);
        }
        if (lastPalmHeightReportedRef.current) {
          lastPalmHeightReportedRef.current = false;
          cbsRef.current.onPalmHeight?.(null);
        }
        lastHandsRef.current = null;
        return;
      }

      // Compute each hand's center (mean of all landmarks). Flip X so the
      // preview behaves like a mirror — moving right on screen feels like
      // moving right in the room.
      const centers = handLandmarks.map(lm => {
        let sx = 0, sy = 0;
        for (const p of lm) { sx += p.x; sy += p.y; }
        return { x: 1 - (sx / lm.length), y: sy / lm.length };
      });

      // Dominant hand = the one with the highest visibility (first by index
      // works well enough in practice — MediaPipe orders by confidence).
      const dominantIdx = 0;
      const dominantCenter = centers[dominantIdx];

      // Smoothed position report → mouseTilt
      const prev = smoothedPosRef.current ?? dominantCenter;
      const sm = {
        x: prev.x + (dominantCenter.x - prev.x) * POSITION_LERP,
        y: prev.y + (dominantCenter.y - prev.y) * POSITION_LERP,
      };
      smoothedPosRef.current = sm;
      cbsRef.current.onHandPosition?.(sm);

      // Gesture (only on the dominant hand). Edge-trigger so the consumer
      // only handles transitions, not every frame.
      const g = classifyGesture(handLandmarks[dominantIdx]);
      if (g !== lastGestureRef.current) {
        lastGestureRef.current = g;
        cbsRef.current.onGesture?.(g);
      }

      // Clap — both hands visible, distance < threshold, fast approach.
      const now = performance.now();
      let twoHandDistance: number | null = null;
      if (centers.length === 2 && lastHandsRef.current && lastHandsRef.current.centers.length === 2) {
        const d  = dist(centers[0], centers[1]);
        twoHandDistance = d;
        const dPrev = lastHandsRef.current.distance;
        const approach = dPrev - d;
        if (d < CLAP_THRESHOLD && approach > APPROACH_VEL && now - lastClapAtRef.current > CLAP_COOLDOWN) {
          lastClapAtRef.current = now;
          cbsRef.current.onClap?.();
        }
      } else if (centers.length === 2) {
        twoHandDistance = dist(centers[0], centers[1]);
      }

      // Palm height — always on (driven by the open-palm gesture). Drives the
      // cyclone radius continuously. No 'extras' gate; this is core now.
      if (g === 'open') {
        lastPalmHeightReportedRef.current = true;
        cbsRef.current.onPalmHeight?.(dominantCenter.y);
      } else if (lastPalmHeightReportedRef.current) {
        lastPalmHeightReportedRef.current = false;
        cbsRef.current.onPalmHeight?.(null);
      }

      lastHandsRef.current = { centers, distance: twoHandDistance ?? 0 };
    }

    function drawOverlay() {
      const canvas = overlayRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const { w, h } = PREVIEW_SIZES[cbsRef.current.size];
      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.floor(w * dpr);
      const targetH = Math.floor(h * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      // Reset to identity then scale by dpr so we can think in CSS pixels.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (!cbsRef.current.showSkeleton) return;
      const results = lastResultsRef.current;
      const handLandmarks: Array<Array<{ x: number; y: number }>> = results?.landmarks ?? [];
      if (handLandmarks.length === 0) return;

      // Two-hand palette: hand 0 cyan, hand 1 magenta. Stroke ~2px, fingertips
      // brighter than knuckles. Drawn in raw (non-mirrored) coordinates — the
      // canvas element itself is CSS-mirrored to match the video.
      const COLORS = [
        { line: 'rgba(80, 220, 255, 0.85)', dot: '#fff', tip: '#7cffaa' },
        { line: 'rgba(255, 140, 220, 0.85)', dot: '#fff', tip: '#ffd07c' },
      ];
      const FINGERTIP_IDS = new Set([4, 8, 12, 16, 20]);

      for (let hi = 0; hi < handLandmarks.length; hi++) {
        const lm = handLandmarks[hi];
        const c = COLORS[hi % COLORS.length];

        // 1) connections — slightly transparent so dots punch through
        ctx.strokeStyle = c.line;
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        for (const [a, b] of HAND_CONNECTIONS) {
          const pa = lm[a]; const pb = lm[b];
          if (!pa || !pb) continue;
          ctx.beginPath();
          ctx.moveTo(pa.x * w, pa.y * h);
          ctx.lineTo(pb.x * w, pb.y * h);
          ctx.stroke();
        }
        // 2) joint dots — fingertips brighter & larger
        for (let i = 0; i < lm.length; i++) {
          const p = lm[i];
          const tip = FINGERTIP_IDS.has(i);
          ctx.fillStyle = tip ? c.tip : c.dot;
          ctx.beginPath();
          ctx.arc(p.x * w, p.y * h, tip ? 5 : 3.4, 0, Math.PI * 2);
          ctx.fill();
          // dark outline for legibility on bright backgrounds
          ctx.strokeStyle = 'rgba(0,0,0,0.45)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    if (enabled) start();

    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (landmarkerRef.current) {
        try { landmarkerRef.current.close(); } catch { /* ignore */ }
        landmarkerRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
      lastHandsRef.current = null;
      smoothedPosRef.current = null;
      lastGestureRef.current = null;
      setStatus('off');
    };
  }, [enabled]);

  // The <video> element must exist in the DOM whenever enabled so we can wire
  // the stream to it. We hide it (display:none) when showPreview is off; the
  // tracking loop still runs.
  return enabled ? (
    <PreviewShell
      videoRef={videoRef}
      overlayRef={overlayRef}
      status={status}
      showPreview={showPreview}
      size={size}
      layoutMode={layoutMode}
      splitSide={splitSide}
      onChangeLayoutMode={onChangeLayoutMode}
      onChangeSplitSide={onChangeSplitSide}
    />
  ) : null;
}

// ─────────────────────────────────────────────────────────────────────────
// PreviewShell — the rendered webcam tile. Pulled out so HandControl stays
// focused on detection wiring; this component owns the three layout modes
// (normal / split / mini), the drag in normal+mini modes, and the small
// control icons in the top-right.
// ─────────────────────────────────────────────────────────────────────────
function PreviewShell({
  videoRef, overlayRef, status, showPreview, size,
  layoutMode, splitSide, onChangeLayoutMode, onChangeSplitSide,
}: {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  overlayRef: React.MutableRefObject<HTMLCanvasElement | null>;
  status: 'off' | 'loading' | 'ready' | 'denied' | 'error';
  showPreview: boolean;
  size: 's' | 'm' | 'l' | 'xl';
  layoutMode: 'normal' | 'split' | 'mini';
  splitSide: 'left' | 'right';
  onChangeLayoutMode?: (m: 'normal' | 'split' | 'mini') => void;
  onChangeSplitSide?: (s: 'left' | 'right') => void;
}) {
  // ── drag state (only used in normal/mini modes) ────────────────────────
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; baseX: number; baseY: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    // Only drag from the body (not the icon buttons — those have their own handlers).
    const target = e.target as HTMLElement;
    if (target.closest('[data-hand-ctrl-btn]')) return;
    if (layoutMode === 'split') return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStartRef.current = {
      x: e.clientX, y: e.clientY,
      baseX: drag?.x ?? 0,
      baseY: drag?.y ?? 0,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setDrag({ x: dragStartRef.current.baseX + dx, y: dragStartRef.current.baseY + dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    dragStartRef.current = null;
  };

  // ── geometry per mode ──────────────────────────────────────────────────
  let containerStyle: React.CSSProperties = {
    position: 'fixed',
    borderRadius: 16,
    overflow: 'hidden',
    background: 'rgba(20,20,20,0.6)',
    boxShadow: '0 18px 36px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.12)',
    backdropFilter: 'blur(18px) saturate(150%)',
    WebkitBackdropFilter: 'blur(18px) saturate(150%)',
    border: '1px solid rgba(255,255,255,0.55)',
    zIndex: 95,
    pointerEvents: 'auto',
    display: showPreview ? 'block' : 'none',
    opacity: status === 'ready' ? 1 : 0.7,
    transition:
      'opacity 0.3s ease, width 0.35s cubic-bezier(0.22, 1, 0.36, 1), height 0.35s cubic-bezier(0.22, 1, 0.36, 1), inset 0.35s cubic-bezier(0.22, 1, 0.36, 1), border-radius 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
    cursor: layoutMode === 'split' ? 'default' : (dragStartRef.current ? 'grabbing' : 'grab'),
    userSelect: 'none',
    touchAction: 'none',
  };

  if (layoutMode === 'split') {
    // Half-screen, snapped to a side, no offset.
    containerStyle = {
      ...containerStyle,
      top: 0,
      [splitSide]: 0,
      width: '50vw',
      height: '100vh',
      borderRadius: 0,
      border: 0,
      boxShadow: splitSide === 'right'
        ? '-22px 0 60px rgba(0,0,0,0.18)'
        : '22px 0 60px rgba(0,0,0,0.18)',
    };
  } else if (layoutMode === 'mini') {
    // Tiny PiP. Drag offset shifts it from the bottom-right anchor.
    containerStyle = {
      ...containerStyle,
      bottom: 16 - (drag?.y ?? 0),
      right: 16 + (drag?.x ?? 0),
      width: 144,
      height: 108,
    };
  } else {
    // Normal corner preview, sized via the preset.
    const { w, h } = PREVIEW_SIZES[size];
    containerStyle = {
      ...containerStyle,
      bottom: 16 - (drag?.y ?? 0),
      right: 16 + (drag?.x ?? 0),
      width: w,
      height: h,
    };
  }

  // ── icon buttons in the top-right ──────────────────────────────────────
  const iconBtnStyle: React.CSSProperties = {
    width: 26, height: 26,
    border: 0,
    borderRadius: 8,
    background: 'rgba(20,20,20,0.55)',
    color: '#fff',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
    transition: 'background 0.18s ease',
  };
  const Icon = ({ d, title, onClick }: { d: string; title: string; onClick: () => void }) => (
    <button
      type="button"
      data-hand-ctrl-btn
      title={title}
      aria-label={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerDown={(e) => e.stopPropagation()}
      style={iconBtnStyle}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(40,40,40,0.78)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(20,20,20,0.55)')}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </button>
  );

  return (
    <div
      style={containerStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      aria-hidden="true"
    >
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scaleX(-1)',
          display: 'block',
        }}
      />
      <canvas
        ref={overlayRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          transform: 'scaleX(-1)',
          pointerEvents: 'none',
        }}
      />

      {/* Status overlay */}
      {status !== 'ready' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(15,15,15,0.55)',
            color: 'rgba(255,255,255,0.92)',
            fontFamily: '"Selecta", system-ui, -apple-system, sans-serif',
            fontSize: 11,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
          }}
        >
          {status === 'loading' && 'Loading…'}
          {status === 'denied'  && 'Camera denied'}
          {status === 'error'   && 'Camera error'}
        </div>
      )}

      {/* Control icons (top-right) — visible always; in split mode they're a
          touch larger and on the inner edge for reach. */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          [splitSide === 'right' && layoutMode === 'split' ? 'left' : 'right']: 8,
          display: 'flex',
          gap: 6,
          zIndex: 2,
        }}
      >
        {layoutMode !== 'split' && (
          <Icon
            title="Split screen"
            // square split icon
            d="M4 5h16v14H4zM12 5v14"
            onClick={() => onChangeLayoutMode?.('split')}
          />
        )}
        {layoutMode === 'split' && (
          <Icon
            title={`Swap to ${splitSide === 'right' ? 'left' : 'right'}`}
            // left/right arrows
            d="M7 8l-4 4 4 4M17 8l4 4-4 4M3 12h18"
            onClick={() => onChangeSplitSide?.(splitSide === 'right' ? 'left' : 'right')}
          />
        )}
        {layoutMode !== 'mini' && (
          <Icon
            title="Picture in picture"
            // PiP: outer frame + inner small frame bottom-right
            d="M3 5h18v14H3zM13 13h7v5h-7z"
            onClick={() => { onChangeLayoutMode?.('mini'); setDrag(null); }}
          />
        )}
        {layoutMode !== 'normal' && (
          <Icon
            title="Restore"
            // restore square
            d="M4 14v6h6M20 10V4h-6M4 20l7-7M20 4l-7 7"
            onClick={() => { onChangeLayoutMode?.('normal'); setDrag(null); }}
          />
        )}
      </div>
    </div>
  );
}
