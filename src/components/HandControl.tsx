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

export type HandGesture = 'open' | 'fist' | 'point' | null;

interface HandControlProps {
  enabled: boolean;
  /** Fires once per clap. */
  onClap?: () => void;
  /** Normalized 0..1 position of the dominant hand center (null when nothing seen). */
  onHandPosition?: (pos: { x: number; y: number } | null) => void;
  /** Current gesture of the dominant hand. Fires only when it changes. */
  onGesture?: (g: HandGesture) => void;
  /** Whether to wire the four extra gestures (pinch / spread / height / point). */
  extras?: boolean;
  /** Fires once per pinch (thumb+index tip touch). Position is the pinch point. */
  onPinch?: (pos: { x: number; y: number }) => void;
  /** Continuous: fires while index-finger point is held; null when released. */
  onIndexPoint?: (pos: { x: number; y: number } | null) => void;
  /** Continuous height (0=top, 1=bottom) while an open palm is visible. null otherwise. */
  onPalmHeight?: (y: number | null) => void;
  /** One-shot two-hand impulses. magnitude is roughly proportional to speed (clamped 0..1). */
  onSpread?: (magnitude: number) => void;
  onSqueeze?: (magnitude: number) => void;
  /** Whether the small preview should be visible. */
  showPreview?: boolean;
  /** Reports loading/error state up so the panel can show "Loading…" / "Denied". */
  onStatus?: (s: 'loading' | 'ready' | 'denied' | 'error' | 'off') => void;
  /** Preview size preset. Width × height: s=192×144, m=288×216, l=416×312, xl=576×432. */
  size?: 's' | 'm' | 'l' | 'xl';
  /** Render the live skeleton (landmarks + connections) on top of the video. */
  showSkeleton?: boolean;
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
const PINCH_THRESHOLD = 0.055; // thumb+index tip dist below this counts as pinch
const PINCH_COOLDOWN  = 320;   // ms between accepted pinches
const TWOHAND_VEL_MIN = 0.06;  // per-frame inter-hand distance change to call spread/squeeze
const TWOHAND_COOLDOWN = 350;  // ms between spread/squeeze events

// Landmark indices that MediaPipe's hand model uses.
// Reference: https://developers.google.com/mediapipe/solutions/vision/hand_landmarker
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const FINGERTIPS = [4, 8, 12, 16, 20];   // thumb, index, middle, ring, pinky
const KNUCKLES   = [2, 5, 9, 13, 17];

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function classifyGesture(landmarks: Array<{ x: number; y: number }>): HandGesture {
  const wrist = landmarks[WRIST];
  // Track per-finger extension state. Index 0=thumb, 1=index, 2=middle, 3=ring, 4=pinky.
  const extended: boolean[] = [false, false, false, false, false];
  const curled: boolean[]   = [false, false, false, false, false];
  for (let i = 0; i < 5; i++) {
    const tip = landmarks[FINGERTIPS[i]];
    const knuckle = landmarks[KNUCKLES[i]];
    if (!tip || !knuckle) return null;
    const dTip = dist(tip, wrist);
    const dKnuckle = dist(knuckle, wrist);
    if (dTip > dKnuckle * 1.25) extended[i] = true;
    else if (dTip < dKnuckle * 0.95) curled[i] = true;
  }
  const extCount = extended.filter(Boolean).length;
  const curlCount = curled.filter(Boolean).length;
  if (extCount >= 4) return 'open';
  if (curlCount >= 4) return 'fist';
  // Index-point = index extended, middle + ring + pinky curled (thumb either way).
  if (extended[1] && curled[2] && curled[3] && curled[4]) return 'point';
  return null;
}

export default function HandControl({
  enabled,
  onClap,
  onHandPosition,
  onGesture,
  extras = false,
  onPinch,
  onIndexPoint,
  onPalmHeight,
  onSpread,
  onSqueeze,
  showPreview = true,
  onStatus,
  size = 'm',
  showSkeleton = true,
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
  const lastPinchAtRef = useRef(0);
  const lastSpreadAtRef = useRef(0);
  const smoothedPosRef = useRef<{ x: number; y: number } | null>(null);
  const lastGestureRef = useRef<HandGesture>(null);
  const lastIndexPointReportedRef = useRef(false);
  const lastPalmHeightReportedRef = useRef(false);

  const [status, setStatus] = useState<'off' | 'loading' | 'ready' | 'denied' | 'error'>('off');

  // Keep latest callback refs so the rAF loop doesn't capture stale closures.
  const cbsRef = useRef({
    onClap, onHandPosition, onGesture,
    onPinch, onIndexPoint, onPalmHeight, onSpread, onSqueeze,
    extras,
    size, showSkeleton,
  });
  cbsRef.current = {
    onClap, onHandPosition, onGesture,
    onPinch, onIndexPoint, onPalmHeight, onSpread, onSqueeze,
    extras,
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
        if (lastIndexPointReportedRef.current) {
          lastIndexPointReportedRef.current = false;
          cbsRef.current.onIndexPoint?.(null);
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

      // Clap + two-hand spread/squeeze (mutually exclusive — clap wins).
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
        } else if (cbsRef.current.extras && Math.abs(approach) > TWOHAND_VEL_MIN && now - lastSpreadAtRef.current > TWOHAND_COOLDOWN) {
          // Spread = distance growing; Squeeze = shrinking but not a clap.
          // Magnitude scales linearly with per-frame |approach|, clamped 0..1.
          const mag = Math.min(1, Math.abs(approach) / 0.25);
          if (approach < 0) {
            lastSpreadAtRef.current = now;
            cbsRef.current.onSpread?.(mag);
          } else {
            lastSpreadAtRef.current = now;
            cbsRef.current.onSqueeze?.(mag);
          }
        }
      } else if (centers.length === 2) {
        twoHandDistance = dist(centers[0], centers[1]);
      }

      // ─── Extras (only when enabled by the panel toggle) ─────────────────
      if (cbsRef.current.extras) {
        const dom = handLandmarks[dominantIdx];

        // Pinch — thumb tip + index tip < threshold. Position is the midpoint.
        // Note: hand landmarks are NOT x-flipped (only the smoothed center is),
        // so we flip x ourselves for the report.
        const thumb = dom[THUMB_TIP];
        const idxTip = dom[INDEX_TIP];
        if (thumb && idxTip) {
          const pinchD = dist(thumb, idxTip);
          if (pinchD < PINCH_THRESHOLD && now - lastPinchAtRef.current > PINCH_COOLDOWN) {
            lastPinchAtRef.current = now;
            cbsRef.current.onPinch?.({
              x: 1 - (thumb.x + idxTip.x) / 2,
              y: (thumb.y + idxTip.y) / 2,
            });
          }
        }

        // Index point — continuous tractor-beam target at the index fingertip.
        if (g === 'point' && idxTip) {
          lastIndexPointReportedRef.current = true;
          cbsRef.current.onIndexPoint?.({ x: 1 - idxTip.x, y: idxTip.y });
        } else if (lastIndexPointReportedRef.current) {
          lastIndexPointReportedRef.current = false;
          cbsRef.current.onIndexPoint?.(null);
        }

        // Palm height — when an open palm is visible, continuously report its
        // Y in viewport-normalized (0=top, 1=bottom). Drives cyclone radius.
        if (g === 'open') {
          lastPalmHeightReportedRef.current = true;
          cbsRef.current.onPalmHeight?.(dominantCenter.y);
        } else if (lastPalmHeightReportedRef.current) {
          lastPalmHeightReportedRef.current = false;
          cbsRef.current.onPalmHeight?.(null);
        }
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
  if (!enabled) return null;

  const { w: previewW, h: previewH } = PREVIEW_SIZES[size];

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        width: previewW,
        height: previewH,
        borderRadius: 16,
        overflow: 'hidden',
        background: 'rgba(20,20,20,0.6)',
        boxShadow: '0 18px 36px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.12)',
        backdropFilter: 'blur(18px) saturate(150%)',
        WebkitBackdropFilter: 'blur(18px) saturate(150%)',
        border: '1px solid rgba(255,255,255,0.55)',
        zIndex: 95,
        pointerEvents: 'none',
        display: showPreview ? 'block' : 'none',
        opacity: status === 'ready' ? 1 : 0.6,
        // Smooth resize when the user toggles S/M/L/XL.
        transition: 'opacity 0.3s ease, width 0.3s cubic-bezier(0.22, 1, 0.36, 1), height 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      aria-hidden="true"
    >
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        // CSS mirror so it feels like a selfie.
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
      {/* Skeleton overlay — mirrored to match the video. Drawn in raw landmark
          coords; the scaleX(-1) on the canvas flips them to display space. */}
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
    </div>
  );
}
