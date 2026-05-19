import { useEffect, useRef, useState, useCallback } from 'react';
import Matter from 'matter-js';
import Header from './components/Header';
import Footer from './components/Footer';
import Joystick, {
  playLeverSound,
  playBubbleSound,
  playWhooshSound,
  type JoystickSound,
} from './components/Joystick';
import HandControl from './components/HandControl';
import HandToolbar from './components/HandToolbar';
import PersonalSubhead from './components/PersonalSubhead';
import DraggableProps from './components/DraggableProps';

interface OrbData {
  id: string;
  imageUrl: string;
  image: HTMLImageElement | null;
  username?: string;
  appId?: string;
  appTitle?: string;
}

interface SelectedOrb {
  bodyId: number;
  data: OrbData;
  startX: number;
  startY: number;
}

// Shared style for the round icon buttons in the app card modal
const iconCircleBtn = (): React.CSSProperties => ({
  width: 52,
  height: 52,
  borderRadius: '50%',
  border: 0,
  background: '#ededed',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'transform 0.2s ease, background 0.2s ease',
  padding: 0,
});

const DAILY_STORAGE_KEY = 'orb-drop-date';
const ORBS_STORAGE_KEY = 'orb-drop-orbs';
const COVERS_STORAGE_KEY = 'orb-drop-covers';
const BASE_RADIUS = 48;
const MIN_SCALE = 0.9;
const MAX_SCALE = 1.1;
// Use proxy in development to avoid CORS, direct URL in production
const WABI_API_URL = import.meta.env.DEV
  ? '/api/wabi/app/random-covers?count=60'
  : 'https://api.wabi.ai/api/v1/app/random-covers?count=60';

const FALLBACK_ORBS = [
  'https://i.imgur.com/4Aq1p5V.png',
  'https://i.imgur.com/qx8f4iH.png',
  'https://i.imgur.com/AWPO3TG.png',
  'https://i.imgur.com/p9lsZOd.png',
  'https://i.imgur.com/vwH7fhY.png',
  'https://i.imgur.com/LMjFvVQ.png',
];

const MOCK_NAMES = ['Alex', 'Jordan', 'Sam', 'Taylor', 'Casey', 'Morgan', 'Riley', 'Quinn', 'Avery', 'Jamie'];
const MOCK_TITLES = ['My Cool App', 'Daily Tracker', 'Fitness Pro', 'Recipe Book', 'Travel Log', 'Music Player', 'Photo Editor', 'Task Manager', 'Weather App', 'Game Hub'];

// Extract app ID from CloudFront URL, or generate mock ID
const extractAppId = (url: string): string => {
  const match = url.match(/cloudfront\.net\/([a-f0-9]+)\//);
  if (match) return match[1];
  // Generate a consistent mock ID from the URL for demo purposes
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash) + url.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
};

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasFrontRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const orbDataRef = useRef<Map<number, OrbData>>(new Map());
  const preloadedImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const coverUrlsRef = useRef<string[]>([]);
  // Tracks which cover URLs have already been handed out so we don't repeat
  // until the pool is exhausted (dedup-aware random picker below).
  const usedCoversRef = useRef<Set<string>>(new Set());
  // Holds AI-generated orb URLs (data: URLs from /api/generate-orb).
  // These are prioritized by the picker so freshly-made orbs show up next.
  const aiCoversRef = useRef<string[]>([]);
  // (Generate-orb state removed along with the panel UI and callback.)
  const mouseConstraintRef = useRef<Matter.MouseConstraint | null>(null);
  const overlayImageRef = useRef<HTMLImageElement | null>(null);

  const [, setOrbCount] = useState(0);
  const [, setLatestUser] = useState<string | null>(null);
  // Damping slider was removed from the panel; setter is no longer used.
  const [damping] = useState(0.005);
  const [moonMode, setMoonMode] = useState(false);
  const [showControls, setShowControls] = useState(true);
  // Default 'right' — pairs with personalMode default (copy on left, phone on right).
  const [layout, setLayout] = useState<'left' | 'center' | 'right'>('right');
  const [selectedOrb, setSelectedOrb] = useState<SelectedOrb | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [lightMode, setLightMode] = useState(false);
  const [displayMode, setDisplayMode] = useState<'physics' | 'cyclone' | 'orbit' | 'shapes'>('cyclone');
  const [renderStyle] = useState<'simple' | 'glass' | 'shaders'>('glass');
  const [enableOrbTap] = useState(true);
  const [activePhone, setActivePhone] = useState(0); // 0/1/2 - which dashboard is in front
  const [phonesFanned, setPhonesFanned] = useState(false); // back phones fan in after load
  // Mirrors the facepile: which persona is the user currently hovering /
  // has selected. Drives the avatar that overlays the phone's top-right.
  const [hoveredFaceId, setHoveredFaceId] = useState<number | null>(null);
  const [activeNotif, setActiveNotif] = useState<null | 'chat' | 'like'>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfiles, setShowProfiles] = useState(false);
  // (Bento section removed entirely — `showBento` state and the <section>
  // below the hero are gone. Hand-mode cascade no longer touches it.)
  // 3D persona props (heart / mobile / globe / atlas / controller / cursor / etc.)
  // that float around the phone, themed to the active persona. Off by default —
  // they're more of a flourish than a baseline.
  const [showPersonaProps, setShowPersonaProps] = useState(false);
  // Master switch for the orb canvases. When off, the Matter physics loop
  // keeps running (orbs still exist) but neither canvas paints them, so the
  // landing reads as a clean text-only hero. Default off — the lever
  // reveals them on first pull.
  const [showOrbs, setShowOrbs] = useState(false);
  const showOrbsRef = useRef(showOrbs);
  useEffect(() => { showOrbsRef.current = showOrbs; }, [showOrbs]);
  // Three-state lever (0 = hidden, 1 = cyclone, 2 = physics). Cycles per
  // pull. Drives the joystick's tilt + the orbs flow above.
  const [leverState, setLeverState] = useState<0 | 1 | 2>(0);
  const leverStateRef = useRef<0 | 1 | 2>(0);
  useEffect(() => { leverStateRef.current = leverState; }, [leverState]);
  // Alternate "Make it personal" layout — replaces headline + subhead with a
  // larger left-positioned headline and a cycling-word subhead.
  // Default ON (per the latest direction).
  const [personalMode, setPersonalMode] = useState(true);
  // Toggle for the inline 3D icon that sits in front of the cycling word in
  // the personal subhead. Defaults OFF so the subhead reads as clean inline
  // type; flipping it on re-introduces the icon-per-word treatment.
  const [showCyclingIcon, setShowCyclingIcon] = useState(false);
  // "Manifesto unlocking..." toast — shown for 3s after the M key is
  // pressed, then the page navigates to manifesto.joonasvirtanen.com.
  const [manifestoUnlocking, setManifestoUnlocking] = useState(false);
  const manifestoUnlockingRef = useRef(false);
  // Ref-sync so the rAF render loop can read the latest value cheaply —
  // used to keep the cyclone center anchored to the phone's tighter
  // personalMode position.
  const personalModeRef = useRef(personalMode);
  useEffect(() => { personalModeRef.current = personalMode; }, [personalMode]);

  // Mobile breakpoint — copy stacks above the phone, control panel boots
  // collapsed, font sizes shift, etc.
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 640px)').matches;
  });
  const isMobileRef = useRef(isMobile);
  useEffect(() => { isMobileRef.current = isMobile; }, [isMobile]);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // (Scroll-driven cyclone tilt — implemented INSIDE the render loop so
  // the target updates every frame even during iOS Safari's momentum
  // scroll, which heavily throttles scroll events. The scrollTiltRef
  // pair is eased toward the live scroll position there. No standalone
  // listener needed.)
  // Control panel collapsed to a small pill — true by default on mobile.
  const [panelCollapsed, setPanelCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 640px)').matches;
  });
  // Drag offset applied to the expanded control panel (delta from its default
  // top-left anchor). Lets the user shove the panel out of the way when it
  // covers something they want to look at.
  const [panelOffset, setPanelOffset] = useState({ x: 0, y: 0 });
  const panelDragRef = useRef<{
    startX: number;
    startY: number;
    base: { x: number; y: number };
  } | null>(null);
  const [panelDragging, setPanelDragging] = useState(false);
  // Which synthesized joystick sound to use. Sound-picker UI was removed
  // from the panel, so this stays at its 'lever' default for now.
  const [joystickSound] = useState<JoystickSound>('lever');
  // Ref-sync so resetOrbs (defined below) always plays the latest synth.
  const joystickSoundLatestRef = useRef<JoystickSound>('lever');
  useEffect(() => { joystickSoundLatestRef.current = joystickSound; }, [joystickSound]);
  // Hand-control mode — camera + MediaPipe HandLandmarker, two-hand clap
  // triggers the joystick toggle, gesture (open/fist) flips physics/cyclone,
  // hand position drives the cyclone parallax tilt.
  const [handControl, setHandControl] = useState(false);
  // (Extra gestures removed — pinch/point/spread/squeeze were too false-fire-y.
  //  Core gestures only: open / fist / clap / palm-height.)
  const [handStatus, setHandStatus] = useState<'off' | 'loading' | 'ready' | 'denied' | 'error'>('off');
  const [handCameraSize, setHandCameraSize] = useState<'s' | 'm' | 'l' | 'xl'>('l');
  const [handShowSkeleton, setHandShowSkeleton] = useState(true);
  // High-level "Hand mode" toggle — the one big lever at the bottom of the
  // panel. Flipping it on cascades into handControl + handExtras + focusMode
  // so the user gets the full webcam-driven experience in one click.
  const [handMode, setHandMode] = useState(false);
  // Webcam preview layout — normal corner / split screen / mini PiP.
  const [handLayoutMode, setHandLayoutMode] = useState<'normal' | 'split' | 'mini'>('normal');
  const [handSplitSide, setHandSplitSide] = useState<'left' | 'right'>('right');
  const handLayoutModeRef = useRef(handLayoutMode);
  useEffect(() => { handLayoutModeRef.current = handLayoutMode; }, [handLayoutMode]);
  const handSplitSideRef = useRef(handSplitSide);
  useEffect(() => { handSplitSideRef.current = handSplitSide; }, [handSplitSide]);
  // Cyclone radius multiplier (1.0 = default). Pinned to 1 unless an open
  // palm is held, in which case palm height drives it (high → tight, low → wide).
  const cycloneRadiusMulRef = useRef(1.0);
  const cycloneRadiusMulTargetRef = useRef(1.0);
  // Tractor-beam point in viewport-pixel coords (decays automatically).
  // (x, y, expiresAt) — orbs pull toward this point while it's active.
  const tractorBeamRef = useRef<{ x: number; y: number; expiresAt: number } | null>(null);
  // Two-hand tilt signal (-1..1). Drives an extra rotation around the
  // cyclone's tilt axis so the orbital plane leans with the user's hands.
  // Smoothed via target so it eases instead of snapping.
  const handsTiltRef = useRef(0);
  const handsTiltTargetRef = useRef(0);
  // MOBILE scroll-tilt — scroll progress (0 at top, 1 at bottom) drives an
  // extra cyclone tilt offset so the orbital plane visibly leans as the
  // user scrolls down. Smoothed via target ref so the cyclone eases.
  const scrollTiltRef = useRef(0);
  const scrollTiltTargetRef = useRef(0);
  // Mobile swipe-on-phone gesture state — tracked across pointer events on
  // the phone wrapper so swipe-left/right cycles activePhone (= persona).
  const phoneSwipeRef = useRef<{ x: number; y: number; moved: number } | null>(null);
  // The "committed" persona — what scene we revert to after a hover-preview
  // ends. Click (avatar OR phone) updates this; hover only previews.
  const defaultPersonaRef = useRef(0);
  // `currentShape` kept around because the runtime shapes-mode code path
  // still reads it; we just no longer expose a setter via the UI/keyboard.
  const [currentShape] = useState(0);
  const [showcaseMode, setShowcaseMode] = useState(false);
  // Focus mode = orbs-only-but-keep-controls. Hides the headline, phone,
  // persona props, header, footer, etc. — but the controls panel and the
  // hand-control webcam stay visible. Cyclone re-centers to viewport middle.
  const [focusMode, setFocusMode] = useState(false);
  const [showcaseOrbCount] = useState(60);
  const [orbSize, setOrbSize] = useState(0.8);

  const SHAPES = ['triangle', 'circle', 'square', 'hexagon', 'heart', 'diamond', 'star', 'spiral', 'grid', 'wave'];

  // Refs for keyboard handler and animation
  const moonModeRef = useRef(moonMode);
  const showControlsRef = useRef(showControls);
  const lightModeRef = useRef(lightMode);
  const displayModeRef = useRef(displayMode);
  const renderStyleRef = useRef(renderStyle);
  const enableOrbTapRef = useRef(enableOrbTap);
  const layoutRef = useRef(layout);
  const currentShapeRef = useRef(currentShape);
  const cycloneTimeRef = useRef(0);
  const cycloneFocalAngleRef = useRef(0); // Slowly rotating "big zone" position
  const cycloneSlotCounterRef = useRef(0); // Monotonically-assigned slot per orb
  const spinBoostRef = useRef(0); // Drag-driven extra spin (decays over time)
  // Smoothed cursor offset from viewport center (-1..1) used to tilt the orbit
  const mouseTiltRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const mouseTiltTargetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const orbAnimDataRef = useRef<Map<number, {
    angle: number;
    radius: number;
    speed: number;
    targetX?: number;
    targetY?: number;
    // Cyclone properties
    zLayer?: number; // Fixed depth layer (0=far/small, 1=close/large)
    joinTime?: number; // When orb joined cyclone (for catch-up animation)
    ellipseRatioX?: number;
    ellipseRatioY?: number;
    phaseOffset?: number;
    wobbleSpeed?: number;
    wobbleAmount?: number;
    driftX?: number;
    driftY?: number;
    tiltPhase?: number;
  }>>(new Map());

  // Reveal: front phone shows alone, back phones fan in after a short delay
  useEffect(() => {
    const t = setTimeout(() => setPhonesFanned(true), 850);
    return () => clearTimeout(t);
  }, []);

  // Once the blur-in animation finishes on an element, KILL the animation
  // outright and clear the inline `filter`. Why both?
  //
  // The .blur-in class declares `animation-fill-mode: both`, which means the
  // browser keeps applying the animation's last keyframe forever — and Chrome
  // computes the end-keyframe `filter: none` as `blur(0px)` (interpolation
  // treats `none` as zeroed filter functions). Even a no-op blur(0) on an
  // ANCESTOR creates a filter pipeline that CLIPS descendant `drop-shadow`
  // filters to that ancestor's bounding box — which was hiding the
  // facepile's soft 40/80 shadow under the headline.
  //
  // Setting `animation: none` removes the persisted filter; the inline-style
  // opacity/transform we set alongside it preserves the final visual state.
  useEffect(() => {
    const clear = (e: AnimationEvent) => {
      if (e.animationName === 'blur-in' || e.animationName === 'blur-in-fixed') {
        const el = e.target as HTMLElement;
        el.style.animation = 'none';
        el.style.filter = 'none';
      }
    };
    document.addEventListener('animationend', clear);
    return () => document.removeEventListener('animationend', clear);
  }, []);

  // Reset to first profile when profiles is turned off (single-screen mode)
  useEffect(() => {
    if (!showProfiles) setActivePhone(0);
  }, [showProfiles]);

  // Floating notifications cycle gently: chat → gap → like → gap → repeat.
  // Only runs while `showNotifications` is on; otherwise activeNotif stays null.
  useEffect(() => {
    if (!showNotifications) {
      setActiveNotif(null);
      return;
    }
    const seq: Array<{ which: null | 'chat' | 'like'; ms: number }> = [
      { which: 'chat', ms: 5500 },
      { which: null, ms: 3500 },
      { which: 'like', ms: 5500 },
      { which: null, ms: 3500 },
    ];
    let i = 0;
    let id: number | undefined;
    const tick = () => {
      const step = seq[i % seq.length];
      setActiveNotif(step.which);
      id = window.setTimeout(tick, step.ms);
      i += 1;
    };
    const initial = window.setTimeout(tick, 800);
    return () => {
      window.clearTimeout(initial);
      if (id !== undefined) window.clearTimeout(id);
    };
  }, [showNotifications]);

  useEffect(() => { moonModeRef.current = moonMode; }, [moonMode]);
  useEffect(() => { showControlsRef.current = showControls; }, [showControls]);
  useEffect(() => { lightModeRef.current = lightMode; }, [lightMode]);
  useEffect(() => { displayModeRef.current = displayMode; }, [displayMode]);
  useEffect(() => { renderStyleRef.current = renderStyle; }, [renderStyle]);
  useEffect(() => { enableOrbTapRef.current = enableOrbTap; }, [enableOrbTap]);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  useEffect(() => { currentShapeRef.current = currentShape; }, [currentShape]);
  // Ref-sync focusMode + showcaseMode so the rAF render loop sees the latest
  // value cheaply (they switch the orb cyclone's center point).
  const focusModeRef = useRef(focusMode);
  useEffect(() => { focusModeRef.current = focusMode; }, [focusMode]);
  const showcaseModeRef = useRef(showcaseMode);
  useEffect(() => { showcaseModeRef.current = showcaseMode; }, [showcaseMode]);

  const showcaseOrbCountRef = useRef(showcaseOrbCount);
  const orbSizeRef = useRef(orbSize);
  useEffect(() => { showcaseOrbCountRef.current = showcaseOrbCount; }, [showcaseOrbCount]);
  // Whenever orbSize changes, rescale every existing orb body to match.
  useEffect(() => {
    const prev = orbSizeRef.current;
    if (engineRef.current && prev !== orbSize && prev > 0) {
      const factor = orbSize / prev;
      Matter.Composite.allBodies(engineRef.current.world)
        .filter(b => b.label === 'orb')
        .forEach(body => Matter.Body.scale(body, factor, factor));
    }
    orbSizeRef.current = orbSize;
  }, [orbSize]);

  const dropAllOrbsRef = useRef<(count: number) => void>(() => {});

  const checkDailyReset = () => {
    const today = new Date().toDateString();
    const storedDate = localStorage.getItem(DAILY_STORAGE_KEY);
    if (storedDate !== today) {
      localStorage.setItem(DAILY_STORAGE_KEY, today);
      localStorage.removeItem(ORBS_STORAGE_KEY);
      return true;
    }
    return false;
  };

  const fetchCovers = async (): Promise<string[]> => {
    const cached = localStorage.getItem(COVERS_STORAGE_KEY);
    const today = new Date().toDateString();

    if (cached) {
      try {
        const { date, urls } = JSON.parse(cached);
        if (date === today && urls.length > 0) {
          console.log('Using cached covers:', urls.length);
          return urls;
        }
      } catch (e) { /* fetch fresh */ }
    }

    try {
      console.log('Fetching covers from API...');
      const response = await fetch(WABI_API_URL);
      if (!response.ok) throw new Error('API request failed');
      const json = await response.json();
      console.log('API response:', json);
      const urls = json.data?.covers || [];
      if (urls.length > 0) {
        localStorage.setItem(COVERS_STORAGE_KEY, JSON.stringify({ date: today, urls }));
      }
      return urls;
    } catch (e) {
      console.error('Failed to fetch covers:', e);
      return [];
    }
  };

  const preloadImages = async () => {
    const urls = await fetchCovers();
    coverUrlsRef.current = urls;
    console.log('Covers loaded into ref:', urls.length, 'covers');

    const promises = urls.map((url: string) => {
      return new Promise<void>((resolve) => {
        if (preloadedImagesRef.current.has(url)) { resolve(); return; }
        const img = new Image();
        img.onload = () => { preloadedImagesRef.current.set(url, img); resolve(); };
        img.onerror = () => resolve();
        img.src = url;
      });
    });
    await Promise.all(promises);
  };

  const getRandomCover = (): string => {
    // AI-generated covers jump the queue — drained FIFO so freshly-made orbs
    // appear on the very next spawn after generation.
    if (aiCoversRef.current.length > 0) {
      return aiCoversRef.current.shift() as string;
    }
    const urls = coverUrlsRef.current.length > 0 ? coverUrlsRef.current : FALLBACK_ORBS;
    // Dedup-aware random: prefer URLs we haven't used yet, only repeat once
    // the entire pool has been consumed. Reset the seen-set when exhausted.
    const unused = urls.filter(u => !usedCoversRef.current.has(u));
    if (unused.length === 0) {
      usedCoversRef.current.clear();
    }
    const pool = unused.length > 0 ? unused : urls;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    usedCoversRef.current.add(pick);
    return pick;
  };

  const saveOrbs = useCallback(() => {
    if (!engineRef.current) return;
    const orbs = Matter.Composite.allBodies(engineRef.current.world)
      .filter(b => b.label === 'orb')
      .map(body => {
        const data = orbDataRef.current.get(body.id);
        return {
          id: data?.id,
          x: body.position.x,
          y: body.position.y,
          imageUrl: data?.imageUrl,
          username: data?.username,
          appId: data?.appId,
          appTitle: data?.appTitle,
          radius: (body as any).circleRadius,
        };
      });
    localStorage.setItem(ORBS_STORAGE_KEY, JSON.stringify(orbs));
  }, []);

  const addOrb = useCallback((x?: number, savedOrb?: any, username?: string) => {
    if (!engineRef.current || !canvasRef.current) return;

    const scale = MIN_SCALE + Math.random() * (MAX_SCALE - MIN_SCALE);
    const radius = savedOrb?.radius ?? BASE_RADIUS * scale * orbSizeRef.current;
    const playRight = window.innerWidth * 0.5;
    const posX = savedOrb?.x
      ? Math.min(Math.max(savedOrb.x, radius), playRight - radius)
      : x ?? Math.random() * (playRight - radius * 2) + radius;
    // Clamp Y to be within screen bounds (above the floor)
    const maxY = window.innerHeight - radius - 60;
    const posY = savedOrb?.y
      ? Math.min(savedOrb.y, maxY)
      : -radius * 2;
    const imageUrl = savedOrb?.imageUrl ?? getRandomCover();
    const appId = savedOrb?.appId ?? extractAppId(imageUrl);
    const orbUsername = savedOrb?.username ?? username ?? MOCK_NAMES[Math.floor(Math.random() * MOCK_NAMES.length)];
    const appTitle = savedOrb?.appTitle ?? MOCK_TITLES[Math.floor(Math.random() * MOCK_TITLES.length)];

    const orb = Matter.Bodies.circle(posX, posY, radius, {
      restitution: 0.8,
      friction: 0.05,
      frictionAir: damping,
      density: 0.001,
      label: 'orb',
      slop: 0.01,
      sleepThreshold: 30,
    });

    const orbData: OrbData = {
      id: savedOrb?.id ?? `orb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      imageUrl,
      image: preloadedImagesRef.current.get(imageUrl) || null,
      username: orbUsername,
      appId,
      appTitle,
    };

    if (!orbData.image) {
      const img = new Image();
      img.onload = () => { orbData.image = img; preloadedImagesRef.current.set(imageUrl, img); };
      img.src = imageUrl;
    }

    orbDataRef.current.set(orb.id, orbData);
    Matter.Composite.add(engineRef.current.world, orb);
    setOrbCount(Matter.Composite.allBodies(engineRef.current.world).filter(b => b.label === 'orb').length);
    if (orbUsername) setLatestUser(orbUsername);
    saveOrbs();
  }, [damping, saveOrbs]);

  // Bridge addOrb into toggleLever via a ref so toggleLever (declared earlier)
  // can call it without a circular dependency.
  useEffect(() => {
    addOrbRefForToggle.current = (x?: number) => addOrb(x);
  }, [addOrb]);

  // (generateOrb callback removed along with the panel UI. The
  // /api/generate-orb endpoint still exists if we ever re-surface the
  // feature; restore the useCallback from git history when needed.)

  // Drop all orbs at once for showcase mode
  const dropAllOrbs = useCallback((count: number) => {
    if (!engineRef.current || !canvasRef.current) return;

    // Clear existing orbs first
    Matter.Composite.allBodies(engineRef.current.world).filter(b => b.label === 'orb').forEach(orb => {
      orbDataRef.current.delete(orb.id);
      orbAnimDataRef.current.delete(orb.id);
      Matter.Composite.remove(engineRef.current!.world, orb);
    });
    setOrbCount(0);
    localStorage.removeItem(ORBS_STORAGE_KEY);

    // Drop orbs with randomized timing and positions
    for (let i = 0; i < count; i++) {
      // Random delay between 0 and 2000ms for a more organic drop feel
      const baseDelay = (i / count) * 1500; // Spread over 1.5 seconds
      const randomOffset = (Math.random() - 0.5) * 400; // ±200ms variation
      const delay = Math.max(0, baseDelay + randomOffset);

      setTimeout(() => {
        // Random X position across the play area (left half only)
        const playRight = window.innerWidth * 0.5;
        const margin = playRight * 0.05;
        const x = margin + Math.random() * (playRight - margin * 2);
        addOrb(x);
      }, delay);
    }
  }, [addOrb]);

  useEffect(() => { dropAllOrbsRef.current = dropAllOrbs; }, [dropAllOrbs]);

    // Update damping on all orbs
  useEffect(() => {
    if (!engineRef.current) return;
    Matter.Composite.allBodies(engineRef.current.world)
      .filter(b => b.label === 'orb')
      .forEach(orb => { orb.frictionAir = damping; });
  }, [damping]);

  // Handle orb click - show card
  const handleOrbClick = useCallback((bodyId: number, x: number, y: number) => {
    const data = orbDataRef.current.get(bodyId);
    if (!data) return;

    const body = Matter.Composite.allBodies(engineRef.current!.world).find(b => b.id === bodyId);
    if (!body) return;

    // Freeze the physics orb in place
    Matter.Body.setStatic(body, true);

    // Show card immediately
    setSelectedOrb({ bodyId, data, startX: x, startY: y });
  }, []);

  // Toggle moon gravity
  // Set displayMode (also resets gravity/moon)
  const setMode = useCallback((mode: 'physics' | 'cyclone' | 'orbit' | 'shapes') => {
    if (engineRef.current) {
      engineRef.current.gravity.y = 1;
      // When switching INTO physics, unfreeze + wake every orb. This is the
      // bulletproof fix for "some orbs get stuck mid-air" on lever/clap:
      // cyclone / orbit / shapes call setStatic(true) every frame, which can
      // leave Matter in a sleeping state. setStatic(false) alone won't wake
      // a sleeping body — gravity is ignored — so we explicitly wake each
      // one and add a tiny random velocity so even orbs sitting EXACTLY
      // where they need to fall from don't appear motionless for a beat.
      if (mode === 'physics') {
        Matter.Composite.allBodies(engineRef.current.world)
          .filter(b => b.label === 'orb')
          .forEach(b => {
            Matter.Body.setStatic(b, false);
            Matter.Sleeping.set(b, false);
            Matter.Body.setVelocity(b, {
              x: (Math.random() - 0.5) * 1.6,
              y: 0.4 + Math.random() * 0.4,
            });
          });
      }
    }
    setMoonMode(false);
    setDisplayMode(mode);
  }, []);

  // Shared "reset" — wipe every orb, switch to physics, rain a fresh handful
  // from the top. Triggered by: the clap gesture, the Reset button in the
  // panel, and the R keyboard shortcut. Plays the currently-selected joystick
  // synth as the engage sound so it always lands like a satisfying drop.
  const resetOrbs = useCallback(() => {
    if (!engineRef.current) return;
    // Sound first (independent of orb-mode).
    const s = joystickSoundLatestRef.current;
    const play = s === 'bubble' ? playBubbleSound
              : s === 'whoosh' ? playWhooshSound
              : playLeverSound;
    play(false);

    // Clear every orb.
    Matter.Composite.allBodies(engineRef.current.world)
      .filter(b => b.label === 'orb')
      .forEach(orb => {
        orbDataRef.current.delete(orb.id);
        orbAnimDataRef.current.delete(orb.id);
        Matter.Composite.remove(engineRef.current!.world, orb);
      });
    setOrbCount(0);
    localStorage.removeItem(ORBS_STORAGE_KEY);

    // Force physics so the new orbs fall.
    setMode('physics');

    // Rain 6-8 fresh orbs from the top across the full viewport width.
    const count = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const delay = i * 130 + Math.random() * 80;
      setTimeout(() => {
        const x = Math.random() * (window.innerWidth - 100) + 50;
        addOrbRefForToggle.current?.(x);
      }, delay);
    }
  }, [setMode]);
  useEffect(() => { resetOrbsRef.current = resetOrbs; }, [resetOrbs]);

  // Shared "lever toggle" — flips physics ↔ cyclone exactly like the joystick.
  // Lives at the top level so the joystick AND the hand-clap can both call it.
  const displayModeForToggleRef = useRef(displayMode);
  useEffect(() => { displayModeForToggleRef.current = displayMode; }, [displayMode]);
  const addOrbRefForToggle = useRef<((x?: number) => void) | null>(null);
  // Ref to the latest resetOrbs callback so the R-key keyboard handler — which
  // is bound once inside the main init useEffect — always calls the current
  // version without restarting the engine.
  const resetOrbsRef = useRef<(() => void) | null>(null);
  // Three-state lever cycle:
  //   0 → 1: orbs appear in cyclone formation
  //   1 → 2: orbs drop (physics) + a few fresh ones rain in
  //   2 → 0: orbs hide entirely (back to clean landing)
  const toggleLever = useCallback(() => {
    const next = ((leverStateRef.current + 1) % 3) as 0 | 1 | 2;
    leverStateRef.current = next;
    setLeverState(next);
    if (next === 0) {
      // Hide orbs entirely. setMode optional — leaving as physics so the
      // engine stays calm beneath the hidden canvas.
      setShowOrbs(false);
    } else if (next === 1) {
      setShowOrbs(true);
      setMode('cyclone');
    } else {
      // next === 2 — drop them, rain in a few fresh
      setShowOrbs(true);
      setMode('physics');
      if (addOrbRefForToggle.current) {
        const newOrbCount = 5 + Math.floor(Math.random() * 3);
        for (let i = 0; i < newOrbCount; i++) {
          const delay = i * 90 + Math.random() * 80;
          const x = window.innerWidth * (0.12 + Math.random() * 0.76);
          setTimeout(() => addOrbRefForToggle.current?.(x), delay);
        }
      }
    }
  }, [setMode]);

  // Close card and drop orb from where it was frozen
  const handleCloseCard = useCallback(() => {
    if (!selectedOrb || !engineRef.current) return;

    setIsClosing(true);

    // After card fades out, release the orb
    setTimeout(() => {
      const body = Matter.Composite.allBodies(engineRef.current!.world).find(b => b.id === selectedOrb.bodyId);
      if (body) {
        Matter.Body.setStatic(body, false);
        Matter.Body.setVelocity(body, { x: (Math.random() - 0.5) * 2, y: 0 });
        Matter.Sleeping.set(body, false);
      }
      setSelectedOrb(null);
      setIsClosing(false);
    }, 400);
  }, [selectedOrb]);

  // Main initialization
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animationId: number;
    let walls: Matter.Body[] = [];

    const init = async () => {
      await preloadImages();
      checkDailyReset();

      // Load overlay image
      const overlayImg = new Image();
      overlayImg.src = '/orb-overlay.png';
      await new Promise<void>((resolve) => {
        overlayImg.onload = () => { overlayImageRef.current = overlayImg; resolve(); };
        overlayImg.onerror = () => resolve();
      });

      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      // Front canvas — orbs that should appear in front of the phone
      const canvasFront = canvasFrontRef.current;
      let ctxFront: CanvasRenderingContext2D | null = null;
      if (canvasFront) {
        canvasFront.width = window.innerWidth * dpr;
        canvasFront.height = window.innerHeight * dpr;
        canvasFront.style.width = `${window.innerWidth}px`;
        canvasFront.style.height = `${window.innerHeight}px`;
        ctxFront = canvasFront.getContext('2d');
        if (ctxFront) ctxFront.scale(dpr, dpr);
      }

      const engine = Matter.Engine.create({
        gravity: { x: 0, y: 1 },
        enableSleeping: true,
      });
      engine.positionIterations = 6;
      engine.velocityIterations = 4;
      engineRef.current = engine;

      // Play area: full viewport width, with footer clearance.
      // Desktop: footer is fixed-bottom — 72px clearance so orbs don't
      // overlap the glass footer pill.
      // Mobile: footer is in-flow BELOW the hero — orbs can fall all the
      // way to hero bottom (= top of footer). Clearance = the 80px the
      // static header consumes off the top of the viewport since the
      // canvas is sized to full innerHeight but clipped by the hero.
      const wallThickness = 50;
      const playRight = window.innerWidth;
      const floorY = window.innerHeight - (isMobileRef.current ? 80 : 72);
      walls = [
        Matter.Bodies.rectangle(playRight / 2, floorY + wallThickness / 2, playRight * 2, wallThickness, { isStatic: true, label: 'wall' }),
        Matter.Bodies.rectangle(-wallThickness / 2, window.innerHeight / 2, wallThickness, window.innerHeight * 2, { isStatic: true, label: 'wall' }),
        Matter.Bodies.rectangle(playRight + wallThickness / 2, window.innerHeight / 2, wallThickness, window.innerHeight * 2, { isStatic: true, label: 'wall' }),
      ];
      Matter.Composite.add(engine.world, walls);

      // Always start with 0 orbs
      localStorage.removeItem(ORBS_STORAGE_KEY);

      // Initial orbs — spawn synchronously so every orb gets its cyclone
      // slot on the same frame. The fade-in handles the smooth reveal.
      // The cyclone reads denser at 36+ orbs without sacrificing legibility.
      const INITIAL_DROP_COUNT = 36;
      for (let i = 0; i < INITIAL_DROP_COUNT; i++) {
        const x = Math.random() * (window.innerWidth - 100) + 50;
        addOrb(x);
      }

      const mouse = Matter.Mouse.create(canvas);
      const mouseConstraint = Matter.MouseConstraint.create(engine, {
        mouse,
        constraint: { stiffness: 0.2, render: { visible: false } },
      });
      mouse.pixelRatio = dpr;
      Matter.Composite.add(engine.world, mouseConstraint);
      mouseConstraintRef.current = mouseConstraint;

      // Drag-to-spin + cursor-push for cyclone/orbit modes
      let isDragging = false;
      let lastDragX = 0;
      let lastDragY = 0;
      const isOrbitalMode = () =>
        displayModeRef.current === 'cyclone' || displayModeRef.current === 'orbit';

      // Tracks normalized cursor offset for the parallax orbit tilt.
      // (We no longer push orbs away from the cursor — that broke orb-tap.)
      const updateMouseTilt = (clientX: number, clientY: number) => {
        const rect = canvas.getBoundingClientRect();
        const nx = (clientX - rect.left) / Math.max(1, rect.width) * 2 - 1;
        const ny = (clientY - rect.top) / Math.max(1, rect.height) * 2 - 1;
        mouseTiltTargetRef.current.x = Math.max(-1, Math.min(1, nx));
        mouseTiltTargetRef.current.y = Math.max(-1, Math.min(1, ny));
      };

      const handleDragStart = (e: MouseEvent | TouchEvent) => {
        if (!isOrbitalMode()) return;
        const p = 'touches' in e ? e.touches[0] : e;
        isDragging = true;
        lastDragX = p.clientX;
        lastDragY = p.clientY;
      };
      const handleDragMove = (e: MouseEvent | TouchEvent) => {
        const p = 'touches' in e ? e.touches[0] : e;
        if (!p) return;
        // Update parallax-tilt target from cursor anywhere on the canvas
        if (isOrbitalMode()) updateMouseTilt(p.clientX, p.clientY);
        if (!isDragging) return;
        // Compute tangential drag velocity around the phone-centered motion (per layout)
        const rect = canvas.getBoundingClientRect();
        const _layout = layoutRef.current;
        const _phoneXFrac = _layout === 'left' ? 0.34 : _layout === 'right' ? 0.66 : 0.5;
        const _phoneXOffset = _layout === 'left' ? 40 : _layout === 'right' ? -40 : 0;
        const cx = window.innerWidth * _phoneXFrac + _phoneXOffset;
        const _phoneH = _layout === 'center'
          ? Math.max(390, Math.min(700, window.innerHeight * 0.63))
          : Math.max(420, Math.min(720, window.innerHeight * 0.72));
        const cy = _layout === 'center'
          ? window.innerHeight + window.innerHeight * 0.1 - 80 - _phoneH / 2
          : window.innerHeight / 2;
        const mx = p.clientX - rect.left;
        const my = p.clientY - rect.top;
        const tx = mx - cx;
        const ty = my - cy;
        const len = Math.sqrt(tx * tx + ty * ty) || 1;
        // Tangent direction (CCW perpendicular to radial)
        const tdx = -ty / len;
        const tdy = tx / len;
        const dx = p.clientX - lastDragX;
        const dy = p.clientY - lastDragY;
        const tangentialVel = dx * tdx + dy * tdy;
        spinBoostRef.current = Math.max(-6, Math.min(6, spinBoostRef.current + tangentialVel * 0.02));
        lastDragX = p.clientX;
        lastDragY = p.clientY;
      };
      const handleDragEnd = () => {
        isDragging = false;
      };
      const handleCursorLeave = () => {
        isDragging = false;
      };

      canvas.addEventListener('mousedown', handleDragStart);
      canvas.addEventListener('mousemove', handleDragMove);
      canvas.addEventListener('mouseup', handleDragEnd);
      canvas.addEventListener('mouseleave', handleCursorLeave);
      canvas.addEventListener('touchstart', handleDragStart, { passive: true });
      canvas.addEventListener('touchmove', handleDragMove, { passive: true });
      canvas.addEventListener('touchend', handleDragEnd);

      // Detect click on orb (not drag)
      let mouseDownTime = 0;
      let mouseDownPos = { x: 0, y: 0 };
      let mouseDownBody: Matter.Body | null = null;

      Matter.Events.on(mouseConstraint, 'mousedown', () => {
        mouseDownTime = Date.now();
        mouseDownPos = { x: mouse.position.x, y: mouse.position.y };
        mouseDownBody = mouseConstraint.body; // Capture body at mousedown
      });

      Matter.Events.on(mouseConstraint, 'mouseup', () => {
        const elapsed = Date.now() - mouseDownTime;
        const dx = mouse.position.x - mouseDownPos.x;
        const dy = mouse.position.y - mouseDownPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Quick tap without much movement = click (only when orb-tap is enabled)
        if (enableOrbTapRef.current && elapsed < 200 && dist < 10 && mouseDownBody && mouseDownBody.label === 'orb') {
          handleOrbClick(mouseDownBody.id, mouseDownBody.position.x, mouseDownBody.position.y);
        }
        mouseDownBody = null;
      });

      // Generate shape positions with proper scaling
      const generateShapePositions = (shape: string, count: number, centerX: number, centerY: number) => {
        const positions: { x: number; y: number }[] = [];
        if (count === 0) return positions;

        const padding = 80;
        const maxWidth = window.innerWidth - padding * 2;
        const maxHeight = window.innerHeight - padding * 2;
        const orbSize = BASE_RADIUS * 2.2;

        // Helper to scale positions to fit viewport
        const scaleToFit = (pts: { x: number; y: number }[]) => {
          if (pts.length === 0) return pts;
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          pts.forEach(p => {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
          });
          const width = maxX - minX + orbSize;
          const height = maxY - minY + orbSize;
          const scale = Math.min(1, maxWidth / width, maxHeight / height);
          const offsetX = (minX + maxX) / 2;
          const offsetY = (minY + maxY) / 2;
          return pts.map(p => ({
            x: centerX + (p.x - offsetX) * scale,
            y: centerY + (p.y - offsetY) * scale,
          }));
        };

        if (shape === 'circle') {
          const radius = Math.max(orbSize, count * orbSize / (2 * Math.PI));
          for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
            positions.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
          }
        } else if (shape === 'triangle') {
          const rows = Math.ceil((-1 + Math.sqrt(1 + 8 * count)) / 2);
          let idx = 0;
          for (let row = 0; row < rows && idx < count; row++) {
            const rowCount = row + 1;
            for (let col = 0; col < rowCount && idx < count; col++) {
              positions.push({
                x: (col - rowCount / 2 + 0.5) * orbSize,
                y: (row - rows / 2 + 0.5) * orbSize,
              });
              idx++;
            }
          }
        } else if (shape === 'square') {
          const side = Math.ceil(Math.sqrt(count));
          let idx = 0;
          for (let row = 0; row < side && idx < count; row++) {
            for (let col = 0; col < side && idx < count; col++) {
              positions.push({
                x: (col - side / 2 + 0.5) * orbSize,
                y: (row - side / 2 + 0.5) * orbSize,
              });
              idx++;
            }
          }
        } else if (shape === 'hexagon') {
          // Concentric hexagon rings
          let placed = 0;
          let ring = 0;
          while (placed < count) {
            if (ring === 0) {
              positions.push({ x: 0, y: 0 });
              placed++;
            } else {
              const ringCount = ring * 6;
              for (let i = 0; i < ringCount && placed < count; i++) {
                const angle = (i / ringCount) * Math.PI * 2 - Math.PI / 2;
                positions.push({
                  x: Math.cos(angle) * ring * orbSize,
                  y: Math.sin(angle) * ring * orbSize,
                });
                placed++;
              }
            }
            ring++;
          }
        } else if (shape === 'heart') {
          for (let i = 0; i < count; i++) {
            const t = (i / count) * Math.PI * 2;
            const x = 16 * Math.pow(Math.sin(t), 3);
            const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
            positions.push({ x: x * 8, y: y * 8 });
          }
        } else if (shape === 'diamond') {
          const size = Math.ceil(Math.sqrt(count * 2));
          let idx = 0;
          for (let row = 0; row < size && idx < count; row++) {
            const rowWidth = row < size / 2 ? row + 1 : size - row;
            for (let col = 0; col < rowWidth && idx < count; col++) {
              positions.push({
                x: (col - rowWidth / 2 + 0.5) * orbSize,
                y: (row - size / 2 + 0.5) * orbSize,
              });
              idx++;
            }
          }
        } else if (shape === 'star') {
          const points = 5;
          const outerRadius = Math.max(orbSize * 2, count * orbSize / (points * 2));
          const innerRadius = outerRadius * 0.4;
          for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
            const isOuter = Math.floor(i * points * 2 / count) % 2 === 0;
            const r = isOuter ? outerRadius : innerRadius;
            positions.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
          }
        } else if (shape === 'spiral') {
          const turns = Math.max(2, count / 8);
          for (let i = 0; i < count; i++) {
            const t = (i / count) * turns * Math.PI * 2;
            const r = (i / count) * Math.min(maxWidth, maxHeight) * 0.4;
            positions.push({ x: Math.cos(t) * r, y: Math.sin(t) * r });
          }
        } else if (shape === 'grid') {
          const cols = Math.ceil(Math.sqrt(count * (maxWidth / maxHeight)));
          const rows = Math.ceil(count / cols);
          let idx = 0;
          for (let row = 0; row < rows && idx < count; row++) {
            for (let col = 0; col < cols && idx < count; col++) {
              positions.push({
                x: (col - cols / 2 + 0.5) * orbSize,
                y: (row - rows / 2 + 0.5) * orbSize,
              });
              idx++;
            }
          }
        } else if (shape === 'wave') {
          const cols = Math.ceil(Math.sqrt(count * 2));
          const rows = Math.ceil(count / cols);
          let idx = 0;
          for (let row = 0; row < rows && idx < count; row++) {
            for (let col = 0; col < cols && idx < count; col++) {
              const waveOffset = Math.sin(col * 0.8) * orbSize * 1.5;
              positions.push({
                x: (col - cols / 2 + 0.5) * orbSize,
                y: (row - rows / 2 + 0.5) * orbSize + waveOffset,
              });
              idx++;
            }
          }
        }

        return scaleToFit(positions);
      };

      const render = () => {
        // CRITICAL: schedule the next frame *first*. Any early-return below
        // (e.g. when orbs are hidden) must NOT kill the loop — otherwise
        // toggling orbs back on later finds a dead rAF chain.
        animationId = requestAnimationFrame(render);

        if (!ctx || !engineRef.current) return;

        const mode = displayModeRef.current;
        const style = renderStyleRef.current;
        // Orb play area is constrained to the left half — motion modes center on that
        // Orbital motion centers on the phone for the current layout — except
        // in focus/showcase modes, where there's no phone and we re-center the
        // cyclone to the actual viewport middle.
        const _layout = layoutRef.current;
        const _orbsOnly = focusModeRef.current || showcaseModeRef.current;
        // Split mode: the webcam covers half the screen, so re-center the
        // cyclone into the OTHER half so the orbs aren't behind the video.
        const _splitting = handLayoutModeRef.current === 'split';
        const _splitSide = handSplitSideRef.current;
        // PersonalMode pulls the phone toward the viewport center (66% / 34%
        // vs 72% / 28% in default mode, with 40px vs 60px corrective offset).
        // Mirror those values here so the cyclone center always coincides
        // with the phone center — otherwise the orbit visibly drifts off the
        // phone in personalMode.
        const _pm = personalModeRef.current;
        const _mobile = isMobileRef.current;
        // Mobile + personalMode: phone is centered horizontally near the
        // bottom of the viewport. Cyclone center must match.
        // ANY mobile case (short OR long) uses the same centered-bottom
        // phone-stack layout — short and long should look identical on
        // narrow screens.
        const _mobileAny = _mobile && !_orbsOnly && !_splitting;
        const _phoneXFrac = _mobileAny
          ? 0.5
          : _splitting
            ? (_splitSide === 'right' ? 0.25 : 0.75)
            : _orbsOnly
              ? 0.5
              : _layout === 'left'
                // Both personal and long now share the same phone X
                // fraction (0.34 / 0.66) — keeps the cyclone center aligned
                // with the phone in both variants.
                ? 0.34
                : _layout === 'right'
                  ? 0.66
                  : 0.5;
        const _phoneXOffset = _mobileAny || _orbsOnly || _splitting
          ? 0
          : _layout === 'left'
            ? 40
            : _layout === 'right'
              ? -40
              : 0;
        const centerX = window.innerWidth * _phoneXFrac + _phoneXOffset;
        const _phoneHcalc = _layout === 'center'
          ? Math.max(390, Math.min(700, window.innerHeight * 0.63))
          : Math.max(420, Math.min(720, window.innerHeight * 0.72));
        // Mobile: phone bottom inset 56px from viewport bottom so its
        // drop-shadow has room. Center = (innerHeight - 56) - 0.5 * H.
        // Personal clamp 280-388 (47vh); long clamp 260-344 (42vh).
        // Must match the wrapper-style clamps in the JSX exactly,
        // otherwise the orbital cloud drifts off the device.
        const _mobilePhoneH = _pm
          ? Math.max(280, Math.min(388, window.innerHeight * 0.47))
          : Math.max(260, Math.min(344, window.innerHeight * 0.42));
        const _mobilePhoneBottom = 56;
        const centerY = _mobileAny
          ? window.innerHeight - _mobilePhoneBottom - _mobilePhoneH * 0.5
          : _orbsOnly
            ? window.innerHeight / 2
            : _layout === 'center'
              // Phone bottom is at viewport-bottom + 6% (overflows), so its center
              // is (windowH + windowH*0.06) - phoneH/2 from the top.
              ? window.innerHeight + window.innerHeight * 0.1 - 80 - _phoneHcalc / 2
              // Side layouts: phone is vertically centered.
              : window.innerHeight / 2;

        // Background: light gray (#f0f0f0) for simple/glass, deep blue gradient for shaders
        if (style === 'shaders') {
          const bg = ctx.createLinearGradient(0, 0, 0, window.innerHeight);
          bg.addColorStop(0, '#1d4ed8');
          bg.addColorStop(1, '#0b1f6a');
          ctx.fillStyle = bg;
        } else {
          ctx.fillStyle = '#f0f0f0';
        }
        ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

        const orbs = Matter.Composite.allBodies(engineRef.current.world).filter(b => b.label === 'orb');

        // Drag-driven spin boost decays toward 0
        spinBoostRef.current *= 0.96;
        const spinMult = 1 + spinBoostRef.current;

        // Smooth mouse-tilt toward its target (low-pass filter). 0.045 →
        // ~95% of target in ~1.0s. Combined with input smoothing in
        // HandControl this still kills jitter, but feels less laggy than
        // 0.035 did.
        {
          const t = mouseTiltTargetRef.current;
          const c = mouseTiltRef.current;
          c.x += (t.x - c.x) * 0.045;
          c.y += (t.y - c.y) * 0.045;
        }

        // Update cyclone time and focal angle (very slow base speed)
        if (mode === 'cyclone') {
          cycloneTimeRef.current += 0.0035 * spinMult;
          cycloneFocalAngleRef.current += 0.0008 * Math.abs(spinMult);
        }

        // Orbit mode uses the same time accumulator
        if (mode === 'orbit') {
          cycloneTimeRef.current += 0.0035 * spinMult;
        }

        // Generate shape targets if in shapes mode
        if (mode === 'shapes') {
          const shape = SHAPES[currentShapeRef.current];
          const positions = generateShapePositions(shape, orbs.length, centerX, centerY);
          orbs.forEach((body, i) => {
            if (i < positions.length) {
              let animData = orbAnimDataRef.current.get(body.id);
              if (!animData) {
                animData = { angle: 0, radius: 0, speed: 0 };
                orbAnimDataRef.current.set(body.id, animData);
              }
              animData.targetX = positions[i].x;
              animData.targetY = positions[i].y;
            }
          });
        }

        // Prepare orb render data (front/back split for cyclone & orbit modes)
        const orbRenderData: Array<{
          body: Matter.Body;
          orbData: OrbData | undefined;
          drawX: number;
          drawY: number;
          drawAngle: number;
          radius: number;
          zDepth: number;
          isFront: boolean;
          alpha: number;
        }> = [];

        const nowMs = performance.now();

        orbs.forEach((body) => {
          const orbData = orbDataRef.current.get(body.id);
          const baseRadius = (body as any).circleRadius || BASE_RADIUS;
          let radius = baseRadius;
          let drawX = body.position.x;
          let drawY = body.position.y;
          let drawAngle = body.angle;
          let zDepth = 0;

          // Get or create animation data for this orb
          let animData = orbAnimDataRef.current.get(body.id);
          if (!animData) {
            animData = {
              angle: Math.random() * Math.PI * 2,
              radius: 120 + Math.random() * 180,
              speed: 0.2 + Math.random() * 0.3,
            };
            orbAnimDataRef.current.set(body.id, animData);
          }

          if (mode === 'cyclone') {
            // Cyclone: tilted 3D ring around the phone.
            // Orbs traveling LEFT pass in front (worldZ > 0), RIGHT pass behind (worldZ < 0).
            const time = cycloneTimeRef.current;

            if (animData.ellipseRatioX === undefined) {
              animData.zLayer = Math.random();
              animData.ellipseRatioX = 1.0;
              // Vertical stretch of the orbit so it wraps the tall phone
              animData.ellipseRatioY = 1.05 + Math.random() * 0.25;
              animData.phaseOffset = Math.random() * Math.PI * 2;
              // Wall-clock timestamp when this orb first entered cyclone — used
              // for the smooth fade-in reveal.
              (animData as any).cycloneFadeStartMs = performance.now();
              // Permanent slot — once assigned, never changes. New orbs get the
              // next slot via the counter ref; golden-angle distribution keeps
              // spacing well-distributed without N-dependent recomputation.
              (animData as any).cycloneSlot = cycloneSlotCounterRef.current;
              cycloneSlotCounterRef.current += 1;
            }
            const zLayer = animData.zLayer ?? 0.5;

            // Single shared angular velocity so orbs keep their even spacing.
            const angularSpeed = 0.85;

            // Ellipse sized to wrap the centered phone, capped to viewport.
            // Padding around the phone trimmed from +90 → +50 so the orbit
            // hugs the device tighter (felt too broad before).
            const phoneH = Math.max(390, Math.min(700, window.innerHeight * 0.63));
            const phoneW = phoneH * (402 / 834);
            const minR = Math.max(phoneW / 2, phoneH / 2.6) + 50;
            const maxR = Math.min(window.innerWidth, window.innerHeight) * 0.5;
            // Mobile cyclone bump trimmed back (1.65 → 1.2) — the cloud
            // was too broad on mobile. Snug-around-the-phone reads better
            // than reaching all the way to the footer.
            const mobileBump = _mobileAny ? 1.2 : 1;
            const baseR = Math.min(minR, maxR) * mobileBump * 0.9;
            // Smooth radius multiplier (driven by hand height / hand distance).
            // 0.045 settles in ~1s — silky but still responsive.
            cycloneRadiusMulRef.current +=
              (cycloneRadiusMulTargetRef.current - cycloneRadiusMulRef.current) * 0.045;
            // Split-mode squeeze — webcam owns half the viewport, so shrink the
            // cyclone so orbs don't disappear behind the video tile.
            const splitMul = handLayoutModeRef.current === 'split' ? 0.7 : 1;
            const radMul = cycloneRadiusMulRef.current * splitMul;
            const radiusX = baseR * radMul * (1.0 + zLayer * 0.35);
            const radiusY = radiusX * animData.ellipseRatioY!;

            // Each orb's base angle is determined by its PERMANENT slot, not
            // its current index. Slots are distributed via the golden angle so
            // adding a new orb fills the largest gap automatically without
            // shifting existing orbs.
            const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
            const slot = (animData as any).cycloneSlot ?? 0;
            const baseAngle = slot * GOLDEN_ANGLE;
            const angle = baseAngle + time * angularSpeed;
            const mtX = mouseTiltRef.current.x; // -1..1
            const mtY = mouseTiltRef.current.y;
            // Smooth the two-hand tilt input toward its target each frame so
            // the cyclone eases between angles instead of snapping.
            handsTiltRef.current +=
              (handsTiltTargetRef.current - handsTiltRef.current) * 0.07;
            // Scroll-driven tilt (mobile only).
            // CRITICAL: read scrollY INSIDE the render loop every frame
            // rather than via a scroll event listener — iOS Safari heavily
            // throttles scroll events during momentum scroll (sometimes
            // only firing at the END), which was causing the cyclone to
            // jump between stale targets. Reading directly here keeps the
            // target perfectly fresh, and the standard 0.07 easing
            // smooths out the per-frame deltas.
            if (_mobile) {
              const scrollMax = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
              const scrollProgress = Math.min(1, Math.max(0, window.scrollY / scrollMax));
              scrollTiltTargetRef.current = scrollProgress;
            } else {
              scrollTiltTargetRef.current = 0;
            }
            scrollTiltRef.current +=
              (scrollTiltTargetRef.current - scrollTiltRef.current) * 0.07;
            // TILT = base 1.25 rad (~72°) + cursor/single-hand Y nudge
            // (±0.45 rad) + two-hand angle (±0.7 rad) + scroll-progress
            // tilt (mobile only, ±0.4 rad over the scroll range).
            const scrollTiltContribution = _mobile
              ? (scrollTiltRef.current * 0.8 - 0.4)
              : 0;
            const TILT = 1.25 + mtY * 0.45 + handsTiltRef.current * 0.7 + scrollTiltContribution;
            const YAW = mtX * 0.35;             // mouse-X rotates orbit around Y axis
            const cosT = Math.cos(TILT);
            const sinT = Math.sin(TILT);
            const cosY = Math.cos(YAW);
            const sinY = Math.sin(YAW);
            const planeX = Math.cos(angle) * radiusX;
            const planeV = Math.sin(angle) * radiusY;
            // First tilt around the X axis
            const tiltedY = planeV * cosT;
            const tiltedZ = planeV * sinT;
            // Then yaw around the Y axis
            const worldX = planeX * cosY + tiltedZ * sinY;
            const worldY = tiltedY;
            const worldZ = -planeX * sinY + tiltedZ * cosY;

            // Perspective projection — camera is some distance in front of z=0
            const camDist = 1800;
            const persp = camDist / Math.max(120, camDist - worldZ);

            drawX = centerX + worldX * persp;
            drawY = centerY + worldY * persp;
            radius = baseRadius * persp * (0.55 + zLayer * 0.45);

            // Tractor beam — when an index-point gesture is active, lerp every
            // cyclone orb partway toward the on-screen fingertip. Strength
            // decays back to 0 after the gesture releases.
            const beam = tractorBeamRef.current;
            if (beam && performance.now() < beam.expiresAt) {
              const pull = 0.18;
              drawX = drawX * (1 - pull) + beam.x * pull;
              drawY = drawY * (1 - pull) + beam.y * pull;
            }

            // Sort key: closer (larger worldZ) renders later within its canvas
            zDepth = worldZ;
            drawAngle = 0;

            Matter.Body.setPosition(body, { x: drawX, y: drawY });
            Matter.Body.setStatic(body, true);
          } else if (mode === 'orbit') {
            // 3D orbital motion: smooth, no wobble, perspective-scaled
            const time = cycloneTimeRef.current;

            // Initialize per-orb orbital parameters once
            if ((animData as any).orbitRadius === undefined) {
              const a = animData as any;
              // Orbit radius wraps around the phone in the center, capped to viewport
              const phoneH = Math.max(390, Math.min(700, window.innerHeight * 0.63));
              const phoneW = phoneH * (402 / 834);
              const orbitMin = Math.min(
                Math.max(phoneW / 2, phoneH / 2.6) + 80,
                Math.min(window.innerWidth, window.innerHeight) * 0.4,
              );
              const orbitMax = orbitMin + Math.min(200, Math.min(window.innerWidth, window.innerHeight) * 0.14);
              a.orbitRadius = orbitMin + Math.pow(Math.random(), 0.6) * (orbitMax - orbitMin);
              // Tilt of orbital plane around x-axis (-π/2 to π/2)
              a.inclination = (Math.random() - 0.5) * Math.PI;
              // Rotation of orbital plane around y-axis (0 to 2π)
              a.ascendingNode = Math.random() * Math.PI * 2;
              // Starting position on the orbit
              a.orbitPhase = Math.random() * Math.PI * 2;
              // Angular speed — Kepler-like: outer orbits a bit slower
              a.orbitSpeed = (0.35 + Math.random() * 0.25) * Math.sqrt(200 / a.orbitRadius);
            }
            const a = animData as any;

            const t = time * a.orbitSpeed + a.orbitPhase;
            // Position on the orbit's own plane (z=0)
            const localX = Math.cos(t) * a.orbitRadius;
            const localY = Math.sin(t) * a.orbitRadius;

            // Tilt around x-axis (inclination)
            const cosI = Math.cos(a.inclination);
            const sinI = Math.sin(a.inclination);
            const tiltedX = localX;
            const tiltedY = localY * cosI;
            const tiltedZ = localY * sinI;

            // Rotate around y-axis (ascending node)
            const cosA = Math.cos(a.ascendingNode);
            const sinA = Math.sin(a.ascendingNode);
            const worldX = tiltedX * cosA + tiltedZ * sinA;
            const worldY = tiltedY;
            const worldZ = -tiltedX * sinA + tiltedZ * cosA;

            // Perspective projection — positive worldZ = toward camera.
            // Camera is far so positions don't fly off-screen; only sizes vary.
            const cameraDist = 1200;
            const depth = cameraDist - worldZ;
            const persp = cameraDist / Math.max(depth, 400);

            drawX = centerX + worldX * persp;
            drawY = centerY + worldY * persp;
            radius = baseRadius * persp * 1.15;

            // Sort: closer (larger worldZ) renders on top
            zDepth = worldZ;

            // No body rotation in orbit mode (clean look)
            drawAngle = 0;

            // Update physics body position (for click detection)
            Matter.Body.setPosition(body, { x: drawX, y: drawY });
            Matter.Body.setStatic(body, true);
          } else if (mode === 'shapes') {
            // Shapes mode: smoothly move to target
            if (animData.targetX !== undefined && animData.targetY !== undefined) {
              const dx = animData.targetX - body.position.x;
              const dy = animData.targetY - body.position.y;
              const newX = body.position.x + dx * 0.08;
              const newY = body.position.y + dy * 0.08;
              Matter.Body.setPosition(body, { x: newX, y: newY });
              Matter.Body.setStatic(body, true);
              drawX = newX;
              drawY = newY;
            }
          } else {
            // Physics mode — unfreeze, and defensively wake if sleeping so
            // gravity can act. (The body may have entered sleep while it
            // was kinematic in cyclone/orbit/shapes.) Only wakes if already
            // asleep, so the engine's sleep optimization still kicks in
            // once an orb settles.
            Matter.Body.setStatic(body, false);
            if (body.isSleeping) Matter.Sleeping.set(body, false);
          }

          // Orbs go on the front canvas (above phone) when their worldZ is positive
          // (they're closer to the camera than the phone). cyclone uses worldZ, orbit
          // uses zDepth as worldZ, others stay on the back canvas.
          const isFront = (mode === 'cyclone' || mode === 'orbit') && zDepth > 0;

          // Smooth cyclone fade-in: each orb cubic-ease-outs from 0→1 opacity
          // over ~700ms after first appearing in cyclone, with a tiny per-orb
          // stagger so the ring reveals around rather than all at once.
          let alpha = 1;
          if (mode === 'cyclone') {
            const startMs = (animData as any).cycloneFadeStartMs as number | undefined;
            if (startMs !== undefined) {
              // Stagger by slot for the opening reveal, but cap so newly-added
              // orbs don't have to wait a long time before fading in.
              const slot = (animData as any).cycloneSlot ?? 0;
              const stagger = Math.min(slot, 14) * 22;
              const FADE_MS = 700;
              const elapsed = nowMs - startMs - stagger;
              const p = Math.max(0, Math.min(1, elapsed / FADE_MS));
              alpha = 1 - Math.pow(1 - p, 3);
            } else {
              alpha = 0;
            }
          }
          orbRenderData.push({ body, orbData, drawX, drawY, drawAngle, radius, zDepth, isFront, alpha });
        });

        // Sort by z-depth in cyclone + orbit modes (far/small first, close/large last)
        if (mode === 'cyclone' || mode === 'orbit') {
          orbRenderData.sort((a, b) => a.zDepth - b.zDepth);
        }

        // Clear front canvas each frame (transparent — phone shows through)
        if (ctxFront && canvasFront) {
          ctxFront.clearRect(0, 0, window.innerWidth, window.innerHeight);
        }

        // Master switch — when orbs are toggled off, skip the per-orb draw
        // loop entirely. Physics + position math above still ran so toggling
        // back on brings them in at the right places.
        if (!showOrbsRef.current) return;

        // Render orbs (branches on render style); route to front/back canvas
        orbRenderData.forEach(({ orbData, drawX, drawY, drawAngle, radius, isFront, alpha }) => {
          const tctx = (isFront && ctxFront) ? ctxFront : ctx;
          tctx.save();
          tctx.globalAlpha = alpha;
          tctx.translate(drawX, drawY);
          tctx.rotate(drawAngle);

          if (style === 'simple') {
            // Solid black circle on white bg
            tctx.beginPath();
            tctx.arc(0, 0, radius, 0, Math.PI * 2);
            tctx.closePath();
            tctx.fillStyle = '#0a0a0a';
            tctx.fill();
          } else if (style === 'shaders') {
            const halo = radius * 1.6;
            const haloGrad = tctx.createRadialGradient(0, 0, radius * 0.4, 0, 0, halo);
            haloGrad.addColorStop(0, 'rgba(255, 255, 255, 0.63)');
            haloGrad.addColorStop(0.55, 'rgba(200, 235, 255, 0.315)');
            haloGrad.addColorStop(0.85, 'rgba(255, 200, 235, 0.126)');
            haloGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            tctx.fillStyle = haloGrad;
            tctx.beginPath();
            tctx.arc(0, 0, halo, 0, Math.PI * 2);
            tctx.fill();

            const coreGrad = tctx.createRadialGradient(-radius * 0.15, -radius * 0.2, 0, 0, 0, radius);
            coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
            coreGrad.addColorStop(0.55, 'rgba(245, 252, 255, 0.665)');
            coreGrad.addColorStop(0.85, 'rgba(180, 220, 255, 0.385)');
            coreGrad.addColorStop(1, 'rgba(140, 180, 255, 0)');
            tctx.fillStyle = coreGrad;
            tctx.beginPath();
            tctx.arc(0, 0, radius, 0, Math.PI * 2);
            tctx.fill();

            tctx.lineWidth = Math.max(1, radius * 0.04);
            tctx.strokeStyle = 'rgba(255, 200, 230, 0.245)';
            tctx.beginPath();
            tctx.arc(0, 0, radius * 0.97, 0, Math.PI * 2);
            tctx.stroke();
            tctx.strokeStyle = 'rgba(170, 230, 255, 0.245)';
            tctx.beginPath();
            tctx.arc(0, 0, radius * 1.02, 0, Math.PI * 2);
            tctx.stroke();
          } else {
            // 'glass' (default): image clipped to circle + overlay
            tctx.save();
            tctx.beginPath();
            tctx.arc(0, 0, radius, 0, Math.PI * 2);
            tctx.closePath();
            tctx.clip();
            if (orbData?.image) {
              tctx.drawImage(orbData.image, -radius, -radius, radius * 2, radius * 2);
            } else {
              tctx.fillStyle = '#3b82f6';
              tctx.fill();
            }
            tctx.restore();

            if (overlayImageRef.current) {
              tctx.drawImage(overlayImageRef.current, -radius, -radius, radius * 2, radius * 2);
            }
          }

          tctx.restore();
        });

        // Only update physics in physics mode
        if (mode === 'physics') {
          Matter.Engine.update(engineRef.current, 1000 / 60);
        }
      };

      render();

      const saveInterval = setInterval(saveOrbs, 5000);

      let resizeTimeout: number | null = null;
      const handleResize = () => {
        // IMMEDIATE: Update canvas and walls every frame for smooth resizing
        const dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        ctx.scale(dpr, dpr);

        // Resize front canvas too
        if (canvasFront && ctxFront) {
          canvasFront.width = window.innerWidth * dpr;
          canvasFront.height = window.innerHeight * dpr;
          canvasFront.style.width = `${window.innerWidth}px`;
          canvasFront.style.height = `${window.innerHeight}px`;
          ctxFront.scale(dpr, dpr);
        }

        // Update wall positions immediately. Mobile floor = top of footer
        // (= hero bottom, 80px above viewport bottom in canvas coords);
        // desktop = 72px clearance for the fixed footer.
        const playRightR = window.innerWidth;
        const floorYR = window.innerHeight - (isMobileRef.current ? 80 : 72);
        Matter.Body.setPosition(walls[0], { x: playRightR / 2, y: floorYR + wallThickness / 2 });
        Matter.Body.setPosition(walls[1], { x: -wallThickness / 2, y: window.innerHeight / 2 });
        Matter.Body.setPosition(walls[2], { x: playRightR + wallThickness / 2, y: window.innerHeight / 2 });

        // DEBOUNCED: Reposition orbs after resize settles (prevents glitchy physics)
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = window.setTimeout(() => {
          if (displayModeRef.current === 'physics') {
            const orbs = Matter.Composite.allBodies(engine.world).filter(b => b.label === 'orb');
            const floorY = window.innerHeight - (isMobileRef.current ? 80 : 72);

            orbs.forEach(orb => {
              const radius = (orb as any).circleRadius || BASE_RADIUS;
              const minX = radius + 5;
              const maxX = window.innerWidth * 0.5 - radius - 5;
              const maxY = floorY - radius;

              const isOutside =
                orb.position.x < minX ||
                orb.position.x > maxX ||
                orb.position.y > maxY;

              if (isOutside) {
                const newX = Math.max(minX, Math.min(maxX, orb.position.x));
                const newY = Math.min(maxY, orb.position.y);
                Matter.Body.setPosition(orb, { x: newX, y: newY });
                Matter.Body.setVelocity(orb, { x: 0, y: 0 });
              }

              Matter.Sleeping.set(orb, false);
            });
          }
        }, 100);
      };

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'c' || e.key === 'C') {
          Matter.Composite.allBodies(engine.world).filter(b => b.label === 'orb').forEach(orb => {
            orbDataRef.current.delete(orb.id);
            orbAnimDataRef.current.delete(orb.id);
            Matter.Composite.remove(engine.world, orb);
          });
          setOrbCount(0);
          setLatestUser(null);
          localStorage.removeItem(ORBS_STORAGE_KEY);
        }
        if (e.key === 'r' || e.key === 'R') {
          // Same as the clap gesture + Reset button: wipe, then rain.
          resetOrbsRef.current?.();
        }
        if (e.key === 'm' || e.key === 'M') {
          // Manifesto unlock: show a 3s toast, then jump to the manifesto
          // subdomain. Guard against double-triggers while the unlock is
          // already pending.
          if (!manifestoUnlockingRef.current) {
            manifestoUnlockingRef.current = true;
            setManifestoUnlocking(true);
            window.setTimeout(() => {
              window.location.href = 'https://manifesto.joonasvirtanen.com';
            }, 3000);
          }
        }
        if (e.key === 'd' || e.key === 'D') {
          setShowControls(prev => !prev);
        }
        if (e.key === 'l' || e.key === 'L') {
          setLightMode(prev => !prev);
        }
        if (e.key === 'y' || e.key === 'Y') {
          setDisplayMode(prev => prev === 'cyclone' ? 'physics' : 'cyclone');
          setMoonMode(false);
          engine.gravity.y = 1;
        }
        // (S-key shapes shortcut removed along with the shapes panel
        // option. Shapes mode is still in the runtime if we ever bring it
        // back, but no longer reachable via keyboard.)
        if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
          setDisplayMode('physics');
          engine.gravity.y = 1;
          setMoonMode(false);
          setShowcaseMode(false);
        }
        if (e.key === 'f' || e.key === 'F') {
          setShowcaseMode(true);
          dropAllOrbsRef.current(showcaseOrbCountRef.current);
        }
      };

      const handleAddOrbEvent = (e: CustomEvent) => {
        addOrb(e.detail?.x, undefined, e.detail?.username);
      };

      window.addEventListener('resize', handleResize);
      window.addEventListener('orientationchange', handleResize);
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('addOrb', handleAddOrbEvent as EventListener);

      return () => {
        cancelAnimationFrame(animationId);
        clearInterval(saveInterval);
        if (resizeTimeout) clearTimeout(resizeTimeout);
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('orientationchange', handleResize);
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('addOrb', handleAddOrbEvent as EventListener);
        canvas.removeEventListener('mousedown', handleDragStart);
        canvas.removeEventListener('mousemove', handleDragMove);
        canvas.removeEventListener('mouseup', handleDragEnd);
        canvas.removeEventListener('mouseleave', handleCursorLeave);
        canvas.removeEventListener('touchstart', handleDragStart);
        canvas.removeEventListener('touchmove', handleDragMove);
        canvas.removeEventListener('touchend', handleDragEnd);
        Matter.Engine.clear(engine);
      };
    };

    const cleanup = init();
    return () => { cleanup.then(fn => fn?.()); };
  }, [saveOrbs, handleOrbClick, addOrb]);

  // Click/tap on canvas (not on orb) to add new orb
  const handleCanvasClick = (e: React.MouseEvent) => {
    // Only add orb if we didn't click on an existing one
    if (!mouseConstraintRef.current?.body) {
      addOrb(e.clientX);
    }
  };

  // Touch handler for mobile
  const handleCanvasTouch = (e: React.TouchEvent) => {
    // Only handle single touch, and only if not touching an orb
    if (e.touches.length === 1 && !mouseConstraintRef.current?.body) {
      const touch = e.touches[0];
      addOrb(touch.clientX);
    }
  };

  const appLink = selectedOrb?.data.appId ? `https://wabi.ai/app/${selectedOrb.data.appId}` : '';

  // Anything hidden in BOTH showcase and focus modes uses this flag. The
  // controls panel and the hand-control webcam are special-cased: they stay
  // visible in focus mode (the whole point of focus is "orbs only but I can
  // still tweak them"), and the joystick stays so you can still drop orbs.
  const minimalUI = showcaseMode || focusMode;

  return (
    <div style={{ width: '100%', minHeight: '100%', position: 'relative' }}>
      <style>{`
        .orb-qr-card:hover {
          transform: scale(1.65) !important;
          box-shadow:
            0 30px 50px rgba(0, 0, 0, 0.084),
            0 12px 20px rgba(0, 0, 0, 0.042),
            inset -1.8px -1.8px 1.8px rgba(0, 0, 0, 0.035),
            inset 1.8px 1.8px 1.8px rgba(0, 0, 0, 0.021),
            inset 0 0 12px rgba(0, 0, 0, 0.021) !important;
        }
        @keyframes card-enter {
          0% {
            opacity: 0;
            transform: translateY(30px) scale(0.95);
            filter: blur(12px);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0);
          }
        }
        @keyframes orb-appear {
          from {
            transform: scale(0.8);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes float-soft-a {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-9px) rotate(-0.5deg); }
        }
        @keyframes float-soft-b {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-12px) rotate(0.4deg); }
        }
        @keyframes float-heart {
          0%, 100% { transform: translate(0, 0) rotate(8deg) scale(1); }
          50% { transform: translate(-6px, -14px) rotate(2deg) scale(1.04); }
        }
        @keyframes notif-in {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        /* (scroll-hint-bounce keyframe removed along with the bento section.) */
        /* Control-panel ↔ pill morph. Composes with the inline translate()
           for panelOffset, hence the use of CSS variable --po-x/--po-y so the
           keyframe stays neutral on translate. Falls back to (0,0). */
        @keyframes panel-pop-in {
          0%   { opacity: 0; transform: translate(var(--po-x, 0px), var(--po-y, 0px)) scale(0.85); }
          100% { opacity: 1; transform: translate(var(--po-x, 0px), var(--po-y, 0px)) scale(1); }
        }
        /* Gentle floating motion for persona props. Each prop inlines its
           rotation as --rot, so the animation can compose translate + rotate
           without clobbering the rest of the transform. Three variants stagger
           the rhythm so props don't visibly sync. */
        @keyframes prop-float-a {
          0%, 100% { transform: rotate(var(--rot, 0deg)) translateY(0); }
          50%      { transform: rotate(var(--rot, 0deg)) translateY(-10px); }
        }
        @keyframes prop-float-b {
          0%, 100% { transform: rotate(var(--rot, 0deg)) translate(0, 0); }
          50%      { transform: rotate(var(--rot, 0deg)) translate(4px, -6px); }
        }
        @keyframes prop-float-c {
          0%, 100% { transform: rotate(var(--rot, 0deg)) translate(0, 0); }
          50%      { transform: rotate(var(--rot, 0deg)) translate(-3px, -8px); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="prop-float"] { animation: none !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          .t-avatar { transition: none !important; transform: none !important; }
        }
        @keyframes card-exit {
          0% {
            opacity: 1;
            transform: scale(1);
            filter: blur(0);
          }
          100% {
            opacity: 0;
            transform: scale(0.9);
            filter: blur(8px);
          }
        }
        .card-enter {
          animation: card-enter 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }
        .card-exit {
          animation: card-exit 0.4s cubic-bezier(0.4, 0, 1, 1) forwards;
        }
        .orb-appear {
          animation: orb-appear 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        /* Smooth blur fade-in for first-paint elements. Use \`backwards\`
           so the element renders in its initial state during animation-delay
           (no flash before the stagger kicks in).
           IMPORTANT: end at \`filter: none\`, not \`filter: blur(0)\`.
           Residual \`filter\` on an ancestor (even a no-op blur(0)) creates a
           filter pipeline that clips descendant \`drop-shadow\` filters to the
           ancestor's bounding box — that hides the facepile's soft shadow. */
        @keyframes blur-in {
          0% {
            opacity: 0;
            filter: blur(14px);
            transform: translateY(12px);
          }
          99% {
            opacity: 1;
            filter: blur(0);
            transform: translateY(0);
          }
          100% {
            opacity: 1;
            filter: none;
            transform: translateY(0);
          }
        }
        .blur-in {
          animation: blur-in 1.05s cubic-bezier(0.22, 1, 0.36, 1) both;
          will-change: opacity, filter, transform;
        }
        /* Same fade but no transform — for elements whose layout depends on
           an existing transform (e.g. the phone's translateX(-50%) center). */
        @keyframes blur-in-fixed {
          0%   { opacity: 0; filter: blur(14px); }
          99%  { opacity: 1; filter: blur(0); }
          100% { opacity: 1; filter: none; }
        }
        .blur-in-fixed {
          animation: blur-in-fixed 1.05s cubic-bezier(0.22, 1, 0.36, 1) both;
          will-change: opacity, filter;
        }
        @media (prefers-reduced-motion: reduce) {
          .blur-in, .blur-in-fixed {
            animation: none !important;
            opacity: 1 !important;
            filter: none !important;
            transform: none !important;
          }
        }
      `}</style>

      {/* Header — rendered as a normal block at the top of the document so
          it sits ABOVE the hero on mobile (and gets pinned via position:
          fixed on desktop via the CSS in the component). Pulling it OUT of
          the hero section makes mobile scrolling behave like a normal page
          instead of a weird overflow-clipped subsection. */}
      {!minimalUI && <Header />}

      {/* Hero section (100vh) — contains the canvases, phone, headline, panels */}
      <section style={{
        position: 'relative',
        width: '100%',
        // Mobile: subtract the inline header height (~80px) so the hero
        // still fits in one viewport even with the header in normal flow.
        // Desktop: full viewport since the header is fixed there.
        height: isMobile ? 'calc(100vh - 80px)' : '100vh',
        overflow: 'hidden',
      }}>

      {/* Back canvas: orbs behind the phone */}
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onTouchStart={handleCanvasTouch}
        style={{
          display: 'block',
          cursor: 'pointer',
          // On mobile we MUST allow vertical pan or the user can't scroll
          // the page (the canvas covers the whole hero). 'pan-y' lets the
          // OS handle vertical scroll while still letting us listen for
          // clicks on the canvas. On desktop keep 'none' so orb-drag
          // gestures work without the page scrolling underneath.
          touchAction: isMobile ? 'pan-y' : 'none',
          position: 'absolute',
          inset: 0,
          zIndex: 1,
        }}
      />

      {/* Front canvas: orbs in front of the phone (passthrough pointer events) */}
      <canvas
        ref={canvasFrontRef}
        style={{ display: 'block', position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}
      />

      {/* Headline + subhead (positioned per layout). In personalMode the
          text block stays in the left layout position but is LEFT-aligned
          instead of centered (per the Figma 78:6384 spec), and the headline
          + subhead both lean much bigger. */}
      {!minimalUI && (
        <div style={{
          position: 'absolute',
          ...(personalMode
            ? (isMobile
              ? {
                  // Mobile: stack copy at the top, centered. Pulled
                  // substantially higher (was clamp 96,14vh,140) so the
                  // copy isn't crowding the phone below it.
                  top: 'clamp(20px, 3.5vh, 48px)',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 'min(420px, 88vw)',
                  textAlign: 'center' as const,
                }
              // Desktop personal — mirror the non-personal layout switches:
              //   right → phone on the right, copy on the LEFT (left:)
              //   left  → phone on the left, copy on the RIGHT (right:)
              //   center → copy stacked at top, phone bottom-anchored
              : layout === 'center'
              ? {
                  top: 'clamp(110px, 12vh, 160px)',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 'min(720px, 80vw)',
                  textAlign: 'center' as const,
                }
              : layout === 'left'
              ? {
                  top: '50%',
                  transform: 'translateY(-50%)',
                  right: 'clamp(188px, 17vw, 320px)',
                  width: 'min(560px, 40vw)',
                  textAlign: 'right' as const,
                }
              : {
                  // 'right' — original personal layout.
                  top: '50%',
                  transform: 'translateY(-50%)',
                  // +100px more breathing room on the left edge — pulls the
                  // copy toward center so the composition isn't pinned to the
                  // page edge.
                  left: 'clamp(188px, 17vw, 320px)',
                  width: 'min(560px, 40vw)',
                  textAlign: 'left' as const,
                })
            // ── Long-headline (non-personal) variants ──
            : isMobile
            ? {
                // Mobile non-personal: same centered-top-stack as mobile
                // personal so the two variants render identically.
                top: 'clamp(20px, 3.5vh, 48px)',
                left: '50%',
                transform: 'translateX(-50%)',
                width: 'min(420px, 88vw)',
                textAlign: 'center' as const,
              }
            : layout === 'center'
            ? {
                top: 'clamp(110px, 12vh, 140px)',
                left: '50%',
                transform: 'translateX(-50%)',
                width: 'min(900px, 94vw)',
                textAlign: 'center' as const,
              }
            : {
                // Long-headline side layouts — match the short-headline
                // padding (clamp 188-320) so both variants have the same
                // distance between copy and viewport edge. Width also
                // matches so the column proportions are identical.
                top: '50%',
                transform: 'translateY(-50%)',
                [layout === 'left' ? 'right' : 'left']: 'clamp(188px, 17vw, 320px)',
                width: 'min(560px, 40vw)',
                textAlign: (layout === 'left' ? 'right' : 'left') as 'left' | 'right',
              }),
          color: renderStyle === 'shaders' ? '#ffffff' : '#222',
          fontFamily: '"Selecta", system-ui, -apple-system, sans-serif',
          userSelect: 'none',
          zIndex: 20,
          pointerEvents: 'none',
        }}>
          <h1 className="blur-in" style={{
            fontFamily: '"Kalice", "Selecta", system-ui, -apple-system, sans-serif',
            // personalMode: much bigger Kalice display. Otherwise: match the
            // Figma 53:5760 ratio (center max 50 → 60, side max 40 → 48).
            // personalMode size shrinks on mobile to fit narrow screens.
            // Another -20% pass on top of the previous reduction so the
            // headline reads as confident display type, not a banner.
            fontSize: personalMode
              // +20% on the personal headline (was clamp(24,3.84vw,59)
              // desktop / clamp(26,8.32vw,41) mobile).
              ? (isMobile ? 'clamp(31px, 9.98vw, 49px)' : 'clamp(29px, 4.61vw, 71px)')
              // Long headlines (non-personal) bumped another +25% so the
              // display type carries the layout instead of feeling like
              // a banner. Center: clamp(23,3.2vw,48) → clamp(29,4vw,60).
              // Side:   clamp(19,2.56vw,38) → clamp(24,3.2vw,48).
              : layout === 'center'
              ? 'clamp(29px, 4vw, 60px)'
              : 'clamp(24px, 3.2vw, 48px)',
            lineHeight: personalMode ? 0.98 : 1.11,
            letterSpacing: '-0.01em',
            fontWeight: 400,
            margin: 0,
            // Headline → subhead gap trimmed ~25% (was clamp 20,1.4vh,30)
            // so the two read as a closer pair.
            marginBottom: 'clamp(15px, 1.05vh, 22px)',
            fontFeatureSettings: '"dlig" 1',
            animationDelay: '120ms',
          }}>
            {(() => {
              const ids = [1, 2, 3, 4];
              const selectedId = (activePhone % 4) + 1;
              // Facepile order: on DESKTOP we keep the natural [1,2,3,4]
              // order so hover doesn't reshuffle the row (the wobble while
              // avatars moved under the cursor was distracting). On MOBILE
              // we still lift the selected id to the front so the swipe
              // gesture has a visible "active" position.
              const ordered = isMobile
                ? [selectedId, ...ids.filter((id) => id !== selectedId)]
                : ids;
              const LIFT = -4;
              const FALLOFF = 0.45;
              const SCALE = 1.05;
              const EASE_IN = 'cubic-bezier(0.22, 1, 0.36, 1)';
              const EASE_OUT = 'cubic-bezier(0.34, 3.85, 0.64, 1)';
              const updateSpring = (root: HTMLElement | null, hoveredId: number | null) => {
                if (!root) return;
                root.querySelectorAll<HTMLElement>('.t-avatar').forEach((el) => {
                  const id = Number(el.dataset.avatarId);
                  if (!Number.isFinite(id)) return;
                  if (hoveredId === null) {
                    el.style.setProperty('--avatar-tf', EASE_OUT);
                    el.style.setProperty('--shift', '0px');
                    el.style.setProperty('--scale-active', '1');
                  } else {
                    const hSlot = ordered.indexOf(hoveredId);
                    const tSlot = ordered.indexOf(id);
                    const distance = Math.abs(hSlot - tSlot);
                    const shift = (LIFT * Math.pow(FALLOFF, distance)).toFixed(3);
                    el.style.setProperty('--avatar-tf', EASE_IN);
                    el.style.setProperty('--shift', `${shift}px`);
                    el.style.setProperty('--scale-active', distance === 0 ? String(SCALE) : '1');
                  }
                });
              };
              const facepile = (
                <span
                  className="orb-facepile t-avatar-group"
                  onMouseLeave={(e) => {
                    updateSpring(e.currentTarget, null);
                    setHoveredFaceId(null);
                  }}
                  style={{
                    // Fixed-width inline-block — reordering avatars inside
                    // never affects the surrounding text layout.
                    display: 'inline-block',
                    position: 'relative',
                    width: '2.32em',
                    height: '0.88em',
                    // Slightly less negative → facepile rides a few px higher
                    // (sits more on the text baseline of "ur friends").
                    verticalAlign: '-0.15em',
                    marginRight: '0.22em',
                    // A touch more left padding pushes the cluster right,
                    // away from "ur".
                    marginLeft: '0.16em',
                    pointerEvents: 'auto',
                    // Soft drop shadow below the pile — y=40, blur=80 per the
                    // request. Stacked: a tighter near-shadow (anchors the pile
                    // to the line) + the wide soft one (the long fall-off).
                    // Higher alpha because 80px of blur on #f0f0f0 dilutes fast.
                    filter:
                      'drop-shadow(0 8px 14px rgba(0, 0, 0, 0.084)) drop-shadow(0 40px 80px rgba(0, 0, 0, 0.224))',
                  }}
                >
                  {ids.map((i) => {
                    const slot = ordered.indexOf(i);
                    return (
                      <span
                        key={i}
                        data-avatar-id={i}
                        className="orb-facepile-avatar t-avatar"
                        onMouseEnter={(e) => {
                          const root = e.currentTarget.parentElement as HTMLElement | null;
                          updateSpring(root, i);
                          setHoveredFaceId(i);
                          // Hover = PREVIEW. Phone crossfades via its
                          // slot-opacity transitions, props via the
                          // DraggableProps layer crossfade. onMouseLeave
                          // reverts to the COMMITTED default below.
                          setActivePhone((i - 1) % 3);
                        }}
                        onMouseLeave={() => {
                          // Revert to whichever persona was last committed
                          // (set by clicking the avatar OR the phone).
                          setActivePhone(defaultPersonaRef.current);
                        }}
                        onClick={() => {
                          // Click COMMITS the persona — the scene now
                          // persists after the pointer leaves the avatar.
                          // Works regardless of Fan-out being on.
                          const next = (i - 1) % 3;
                          defaultPersonaRef.current = next;
                          setActivePhone(next);
                        }}
                        style={{
                          position: 'absolute',
                          left: `${slot * 0.48}em`,
                          top: 0,
                          width: '0.88em',
                          height: '0.88em',
                          borderRadius: '50%',
                          overflow: 'hidden',
                          // 2px CSS-only white stroke around each clean avatar.
                          boxShadow: '0 0 0 2px #fff',
                          zIndex: 10 - slot,
                          transformOrigin: 'center',
                          transform: 'translateY(var(--shift, 0px)) scale(var(--scale-active, 1))',
                          willChange: 'transform',
                          transition:
                            'left 0.5s cubic-bezier(0.22, 1, 0.36, 1), z-index 0s linear 0.25s, transform 320ms var(--avatar-tf, cubic-bezier(0.22, 1, 0.36, 1))',
                          pointerEvents: 'auto',
                          cursor: 'pointer',
                        }}
                      >
                        <img
                          src={`/facepile/avatar-${i}.png`}
                          alt=""
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            display: 'block',
                            userSelect: 'none',
                            pointerEvents: 'none',
                          }}
                        />
                      </span>
                    );
                  })}
                </span>
              );
              // "Make it personal" — alternate layout. Facepile renders
              // inside the SUBHEAD instead of the headline. In side layouts
              // (left/right) the headline stacks on two lines so it doesn't
              // sprawl; in the center layout it sits on one line for visual
              // balance with the centered subhead below it.
              if (personalMode) {
                if (layout === 'center') {
                  return (
                    <span style={{ display: 'block', whiteSpace: 'nowrap' }}>Make it personal</span>
                  );
                }
                return (
                  <>
                    <span style={{ display: 'block', whiteSpace: 'nowrap' }}>Make it</span>
                    <span style={{ display: 'block', whiteSpace: 'nowrap' }}>personal</span>
                  </>
                );
              }
              if (layout === 'center') {
                return (
                  <>
                    <span style={{ display: 'block', whiteSpace: 'nowrap' }}>Personal software</span>
                    <span style={{ display: 'block', whiteSpace: 'nowrap' }}>
                      for you and your {facepile} friends
                    </span>
                  </>
                );
              }
              // Side layouts: 3 lines (matches Figma 29:5312)
              return (
                <>
                  <span style={{ display: 'block', whiteSpace: 'nowrap' }}>Personal software</span>
                  <span style={{ display: 'block', whiteSpace: 'nowrap' }}>for you and your</span>
                  <span style={{ display: 'block', whiteSpace: 'nowrap' }}>
                    {facepile} friends
                  </span>
                </>
              );
            })()}
          </h1>
          <p className="blur-in" style={{
            fontFamily: 'inherit',
            // Both variants reduced 20% so the subhead sits below the headline
            // without competing — personalMode was 22-2.28vw-36, default was
            // 13-1.3vw-22.
            fontSize: personalMode
              ? 'clamp(18px, 1.82vw, 29px)'
              : 'clamp(10px, 1.04vw, 18px)',
            // Line height bumped 25% in personalMode (1.18 → 1.475) so the
            // three lines breathe alongside the larger type.
            lineHeight: personalMode ? 1.475 : 1.25,
            letterSpacing: '-0.01em',
            // Figma 53:5758 reads ~#7F7F7F effective (#636363 @ 0.8 alpha on
            // #f0f0f0). Was rgba(99, 99, 99, 0.665) ≈ #6A6A6A — too dark.
            color: renderStyle === 'shaders' ? 'rgba(255, 255, 255, 0.525)' : 'rgba(99, 99, 99, 0.49)',
            margin: 0,
            maxWidth: personalMode ? 'none' : 400,
            // Subhead alignment for the LONG-copy variant:
            //   layout=right (phone right, copy left)  → hug LEFT:  ml 0,    mr auto
            //   layout=left  (phone left,  copy right) → hug RIGHT: ml auto, mr 0
            //   layout=center                          → centered:  ml auto, mr auto
            //   mobile                                 → centered:  ml auto, mr auto
            // PersonalMode keeps the original (no auto-centering — the
            // wrapper width already constrains the block).
            marginLeft: personalMode
              ? 0
              : (isMobile || layout === 'center' || layout === 'left' ? 'auto' : 0),
            marginRight: personalMode
              ? 0
              : (isMobile || layout === 'center' || layout === 'right' ? 'auto' : 0),
            // Subhead distance from the headline. Personal mode used a
            // larger gap (36-60); trimmed ~30% to clamp(25,2.8vh,42).
            marginTop: personalMode ? 'clamp(25px, 2.8vh, 42px)' : 0,
            // One step lighter in personalMode so the bigger size doesn't
            // read as overweight (400 → 300).
            fontWeight: personalMode ? 300 : 400,
            fontFeatureSettings: '"dlig" 1',
            animationDelay: '300ms',
          }}>
            {personalMode ? (
              <PersonalSubhead showIcon={showCyclingIcon} />
            ) : (
              'Describe what you want. Customize the vibe. Share instantly.'
            )}
          </p>

          {/* QR inside the text column on side layouts. Hidden on mobile
              personal mode (no room next to the phone). */}
          {layout !== 'center' && !isMobile && (
            <div
              className="orb-qr-card blur-in"
              style={{
                // Cascade after the subhead so it lands as the last visual
                // beat in the copy column.
                animationDelay: '440ms',
                width: 'clamp(96px, 9vw, 132px)',
                aspectRatio: '1 / 1',
                padding: 'clamp(6px, 0.6vw, 9px)',
                borderRadius: 'clamp(14px, 1.6vw, 22px)',
                // QR follows the headline/subhead alignment. This branch only
                // runs in side layouts (the gating on `layout !== 'center'`
                // above), so we have just left vs right here on desktop.
                // Mobile is hidden upstream so we don't need to handle it.
                // Layout=left  → copy on the right → QR right-aligned (auto left, 0 right)
                // Layout=right → copy on the left  → QR left-aligned  (0 left, auto right)
                // Same rule for short + long now.
                margin: layout === 'left'
                  ? (personalMode
                      ? 'clamp(44px, 5.5vh, 80px) 0 0 auto'
                      : 'clamp(20px, 2.5vh, 36px) 0 0 auto')
                  : (personalMode
                      ? 'clamp(44px, 5.5vh, 80px) 0 0 0'
                      : 'clamp(20px, 2.5vh, 36px) 0 0 0'),
                // Hover-scale grows from the anchor edge that matches the
                // QR's flush side, so the QR doesn't drift on hover.
                transformOrigin: !isMobile
                  ? (layout === 'left' ? 'top right' : 'top left')
                  : 'top center',
                background: renderStyle === 'shaders' ? 'rgba(255, 255, 255, 0.385)' : 'rgba(255, 255, 255, 0.56)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                border: renderStyle === 'shaders'
                  ? '1.5px solid rgba(255, 255, 255, 0.595)'
                  : '1.5px solid rgba(0, 0, 0, 0.035)',
                boxShadow:
                  '0 18px 17px rgba(0, 0, 0, 0.035), inset -1.8px -1.8px 1.8px rgba(0, 0, 0, 0.035), inset 1.8px 1.8px 1.8px rgba(0, 0, 0, 0.021), inset 0 0 12px rgba(0, 0, 0, 0.021)',
                cursor: 'pointer',
                pointerEvents: 'auto',
                transform: 'scale(1)',
                transition: 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              <img
                src="/qr-wabi.png"
                alt="QR code"
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }}
              />
            </div>
          )}
        </div>
      )}

      {/* Draggable behind-the-phone props (atlas / tickets / globe) — only in
          personalMode. Sits below the phone in stacking order so the assets
          peek out from behind it; each prop is individually drag-and-drop. */}
      {!minimalUI && personalMode && (() => {
        const wrapperStyle: React.CSSProperties = isMobile
          ? {
              // Mobile personal: phone anchored near the viewport bottom
              // with a 56px inset for the drop-shadow. Height shrunk ~17%
              // (was clamp(338,57.2vh,468)) so the phone TOP sits lower —
              // giving the headline+subhead clear breathing room above
              // and dropping the cyclone center so the orb cloud reaches
              // further toward the footer.
              position: 'absolute',
              left: '50%',
              bottom: 56,
              transform: 'translate(-50%, 0%)',
              height: 'clamp(280px, 47vh, 388px)',
              aspectRatio: '402 / 834',
            }
          : {
              position: 'absolute',
              left: layout === 'left'
                ? 'calc(34% + 40px)'
                : layout === 'right'
                ? 'calc(66% - 40px)'
                : '50%',
              ...(layout === 'center'
                ? { bottom: 'calc(-10% + 80px)', transform: 'translateX(-50%)' }
                : {
                    top: '50%',
                    transform: `translate(-50%, -50%) rotate(${layout === 'left' ? -4 : 4}deg)`,
                  }),
              height: layout === 'center'
                ? 'clamp(390px, 63vh, 700px)'
                : 'clamp(420px, 72vh, 720px)',
              aspectRatio: '402 / 834',
            };
        // When the lever is pulled (showOrbs = true), the travel props fade
        // out and slide back toward the phone — mirroring their entrance —
        // so the orbs have the stage to themselves.
        // Persona maps to the currently-active phone dashboard.
        // activePhone is 0/1/2; personaId we use externally is 1/2/3.
        return (
          <DraggableProps
            wrapperStyle={wrapperStyle}
            hidden={showOrbs}
            personaId={(activePhone % 3) + 1}
          />
        );
      })()}

      {/* Phone carousel — three dashboards, click to cycle which is in front */}
      {!minimalUI && (() => {
        // Index → dashboard. Index 2 is the GAMES persona (matches avatar 3
        // in the facepile and the GAMES_PROPS set in DraggableProps).
        const PHONE_SOURCES = ['/dash-1.png', '/dash-2.png', '/dash-games.png'];
        // Slot 0 = front, 1 = back-right, 2 = back-left
        const slotForIdentity = (id: number) => (id - activePhone + 3) % 3;
        const slotTransform = (slot: number): React.CSSProperties => {
          if (slot === 0) {
            return { transform: 'translateX(0%) rotate(0deg) scale(1)', zIndex: 3, opacity: 1 };
          }
          // When profiles are off OR before the fan-in completes, the back
          // phones stay tucked behind the front and invisible.
          if (!showProfiles || !phonesFanned) {
            return { transform: 'translateX(0%) rotate(0deg) scale(0.97)', zIndex: slot === 1 ? 2 : 1, opacity: 0 };
          }
          if (slot === 1) {
            return { transform: 'translateX(11%) rotate(4deg) scale(0.95)', zIndex: 2, opacity: 1 };
          }
          // slot 2
          return { transform: 'translateX(-11%) rotate(-4deg) scale(0.95)', zIndex: 1, opacity: 1 };
        };

        // Mobile swipe-to-cycle: horizontal pointer gesture on the phone
        // advances/retreats the active persona. Swipe right = previous
        // persona, swipe left = next persona — matches the "carousel"
        // mental model. The facepile ordering already keys off
        // activePhone, so changing the persona here auto-reorders the
        // facepile too.
        const swipeRef: React.MutableRefObject<{
          x: number;
          y: number;
          moved: number;
        } | null> = phoneSwipeRef;
        const onSwipeDown = (e: React.PointerEvent<HTMLDivElement>) => {
          if (!isMobile) return;
          swipeRef.current = { x: e.clientX, y: e.clientY, moved: 0 };
        };
        const onSwipeMove = (e: React.PointerEvent<HTMLDivElement>) => {
          const s = swipeRef.current;
          if (!s) return;
          s.moved = Math.max(s.moved, Math.hypot(e.clientX - s.x, e.clientY - s.y));
        };
        const onSwipeUp = (e: React.PointerEvent<HTMLDivElement>) => {
          const s = swipeRef.current;
          swipeRef.current = null;
          if (!s) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          // Treat as horizontal swipe if dx is decent and dx >> dy.
          if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.4) {
            setActivePhone(p => {
              const next = dx < 0 ? (p + 1) % 3 : (p - 1 + 3) % 3;
              // Swipe is a committal gesture — update the default too.
              defaultPersonaRef.current = next;
              return next;
            });
          }
        };

        return (
          <div
            className="blur-in-fixed"
            onClick={() => {
              // Click cycles the COMMITTED persona — Fan-out no longer
              // gates this so users can preview the other profiles even
              // before fanning the dashboards out. Mobile routes through
              // swipe instead (handlers below).
              if (isMobile) return;
              const next = (activePhone + 1) % 3;
              defaultPersonaRef.current = next;
              setActivePhone(next);
            }}
            onPointerDown={onSwipeDown}
            onPointerMove={onSwipeMove}
            onPointerUp={onSwipeUp}
            onPointerCancel={() => { swipeRef.current = null; }}
            style={{
              animationDelay: '400ms',
              position: 'absolute',
              // ANY mobile case (short OR long, any layout) uses the
              // same centered-bottom-stack with a 56px bottom inset for
              // the phone drop-shadow. Heights shrunk ~17% from the
              // previous pass so the phone TOP sits lower (more room
              // above for the headline+subhead) and the cyclone center
              // drops, letting the orb cloud reach the footer top:
              //   personal: clamp(338,57.2vh,468) → clamp(280,47vh,388)
              //   long:     clamp(312,52vh,416)   → clamp(260,42vh,344)
              ...(isMobile
                ? {
                    left: '50%',
                    bottom: 56,
                    transform: 'translate(-50%, 0%)',
                    height: personalMode
                      ? 'clamp(280px, 47vh, 388px)'
                      : 'clamp(260px, 42vh, 344px)',
                  }
                : {
                    // Phone position matches personal-mode geometry now
                    // for BOTH variants (34%/66% + 40px) so short and long
                    // headlines share the same phone-vs-copy spacing.
                    left: layout === 'left'
                      ? 'calc(34% + 40px)'
                      : layout === 'right'
                      ? 'calc(66% - 40px)'
                      : '50%',
                    ...(layout === 'center'
                      ? { bottom: 'calc(-10% + 80px)', transform: 'translateX(-50%)' }
                      : {
                          top: '50%',
                          transform: `translate(-50%, -50%) rotate(${layout === 'left' ? -4 : 4}deg)`,
                        }),
                    height: layout === 'center'
                      ? 'clamp(390px, 63vh, 700px)'
                      : 'clamp(420px, 72vh, 720px)',
                  }),
              aspectRatio: '402 / 834',
              zIndex: 5,
              cursor: showProfiles ? 'pointer' : 'default',
              userSelect: 'none',
              transition: 'left 0.4s cubic-bezier(0.22, 1, 0.36, 1), top 0.4s cubic-bezier(0.22, 1, 0.36, 1), bottom 0.4s cubic-bezier(0.22, 1, 0.36, 1), height 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
              // On mobile, use a box-shadow on the wrapper (which has the
              // same rounded outline as the phone via borderRadius) instead
              // of relying on filter:drop-shadow on the inner img. iOS
              // Safari clips the filter strangely against the hero's
              // overflow:hidden boundary; box-shadow renders reliably.
              ...(isMobile
                ? {
                    borderRadius: 25,
                    boxShadow:
                      '0 18px 28px rgba(0, 0, 0, 0.10), 0 6px 10px rgba(0, 0, 0, 0.06)',
                  }
                : {}),
            }}
            title={showProfiles ? 'Click to switch dashboard' : undefined}
          >
            {[0, 1, 2].map((identity) => {
              const slot = slotForIdentity(identity);
              const st = slotTransform(slot);
              return (
                <img
                  key={identity}
                  src={PHONE_SOURCES[identity]}
                  alt=""
                  draggable={false}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    // Mobile gets HALF the corner radius (50 → 25) so the
                    // rounded clip doesn't eat into the dashboard PNG
                    // content at the smaller scale.
                    borderRadius: isMobile ? 25 : 50,
                    pointerEvents: 'none',
                    transformOrigin: '50% 88%',
                    // Mobile uses the wrapper's box-shadow instead (set
                    // above) so the filter:drop-shadow is suppressed here
                    // to avoid double-shadowing.
                    filter: isMobile
                      ? 'none'
                      : (slot === 0
                          ? 'drop-shadow(0 24px 32px rgba(0, 0, 0, 0.098)) drop-shadow(0 0 1px rgba(0, 0, 0, 0.042))'
                          : 'drop-shadow(0 18px 26px rgba(0, 0, 0, 0.07))'),
                    transition:
                      'transform 0.7s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease, z-index 0s linear 0.35s',
                    ...st,
                  }}
                />
              );
            })}

            {/* Persona avatar overlay — sits in the empty top-right area of
                each new dashboard (mirrors the Wabi logo's top-left position).
                Tracks the currently-hovered facepile avatar, falling back to
                whichever phone is in front. */}
            {(() => {
              const fallbackId = (activePhone % 4) + 1;
              const personaId = hoveredFaceId ?? fallbackId;
              return (
                <img
                  key={`persona-${personaId}`}
                  src={`/facepile/avatar-${personaId}.png`}
                  alt=""
                  draggable={false}
                  style={{
                    position: 'absolute',
                    // Mirrors the Wabi logo's position on the dashboard PNGs.
                    top: '3.1%',
                    right: '5.6%',
                    width: '7.2%',
                    aspectRatio: '1',
                    borderRadius: '50%',
                    objectFit: 'cover',
                    pointerEvents: 'none',
                    zIndex: 4,
                    boxShadow: '0 0 0 2px #fff, 0 6px 14px rgba(0, 0, 0, 0.084)',
                    transition: 'opacity 0.3s ease',
                    opacity: 1,
                  }}
                />
              );
            })()}
          </div>
        );
      })()}

      {/* Persona props — themed 3D objects floating around the phone, swapping
          with the active persona. Coordinates are % of the phone container
          (negative values intentionally spill outside the phone bounds). */}
      {!minimalUI && showPersonaProps && (() => {
        // Position fields are percentages of the phone container (the same
        // box the dashboard PNG fills). Negative values are allowed and will
        // render outside the phone outline.
        type PropDef = {
          src: string;
          top?: string; right?: string; bottom?: string; left?: string;
          width: string;      // as % of the phone container width
          rotate?: number;    // initial rotation (deg)
          float?: 'a' | 'b' | 'c'; // pick a float animation variant
          z?: number;
        };
        const PROPS: PropDef[][] = [
          // ▸ Persona 0 — Family
          [
            { src: '/props/family-mobile.png', top: '-18%', left: '-32%',  width: '52%', rotate: -6,  float: 'a', z: 4 },
            { src: '/props/family-heart.png',  bottom: '8%', right: '-30%', width: '38%', rotate:  8,  float: 'b', z: 4 },
          ],
          // ▸ Persona 1 — Travel
          [
            { src: '/props/travel-ticket-map.png', top: '-8%',  right: '-38%', width: '64%', rotate:  10, float: 'a', z: 4 },
            { src: '/props/travel-globe.png',      bottom: '8%', right: '-34%', width: '40%', rotate:  -6, float: 'b', z: 5 },
            { src: '/props/travel-atlas.png',      top: '38%', left: '-44%',  width: '48%', rotate: -12, float: 'c', z: 4 },
          ],
          // ▸ Persona 2 — Games
          [
            { src: '/props/games-controller.png', top: '-4%', right: '-44%', width: '46%', rotate:  12, float: 'a', z: 4 },
            { src: '/props/games-cursor.png',     top: '22%', right: '-22%', width: '22%', rotate:  -8, float: 'b', z: 5 },
            { src: '/props/games-play.png',       bottom: '12%', left: '-26%', width: '28%', rotate: -10, float: 'c', z: 4 },
          ],
        ];

        // Match the phone container's positioning so props sit around it.
        const wrapperStyle: React.CSSProperties = {
          position: 'absolute',
          left: layout === 'left'
            ? (personalMode ? 'calc(34% + 40px)' : 'calc(28% + 60px)')
            : layout === 'right'
            ? (personalMode ? 'calc(66% - 40px)' : 'calc(72% - 60px)')
            : '50%',
          ...(layout === 'center'
            ? { bottom: 'calc(-10% + 80px)', transform: 'translateX(-50%)' }
            : {
                top: '50%',
                transform: `translate(-50%, -50%) rotate(${layout === 'left' ? -4 : 4}deg)`,
              }),
          height: layout === 'center'
            ? 'clamp(390px, 63vh, 700px)'
            : 'clamp(420px, 72vh, 720px)',
          aspectRatio: '402 / 834',
          // Props sit ABOVE the front-canvas orbs (z=6) and phone (z=5) since
          // they're the persona-defining hero decoration.
          zIndex: 7,
          pointerEvents: 'none',
          transition: 'left 0.4s cubic-bezier(0.22, 1, 0.36, 1), top 0.4s cubic-bezier(0.22, 1, 0.36, 1), bottom 0.4s cubic-bezier(0.22, 1, 0.36, 1), height 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
        };

        return (
          <div style={wrapperStyle} aria-hidden="true">
            {PROPS.flatMap((personaProps, personaIdx) =>
              personaProps.map((p, i) => {
                const active = personaIdx === activePhone;
                const animName = p.float ? `prop-float-${p.float}` : 'prop-float-a';
                return (
                  <img
                    key={`p-${personaIdx}-${i}`}
                    src={p.src}
                    alt=""
                    draggable={false}
                    style={{
                      position: 'absolute',
                      top: p.top, right: p.right, bottom: p.bottom, left: p.left,
                      width: p.width,
                      height: 'auto',
                      zIndex: p.z ?? 4,
                      opacity: active ? 1 : 0,
                      // Custom property consumed by the prop-float-* keyframes
                      // so the animation can compose translate + rotate.
                      ['--rot' as any]: `${p.rotate ?? 0}deg`,
                      transform: `rotate(${p.rotate ?? 0}deg)`,
                      animation: active
                        ? `${animName} 6.5s ease-in-out infinite ${(i * 0.7).toFixed(2)}s`
                        : 'none',
                      // Pop in slightly delayed so each persona's props cascade
                      transitionDelay: active ? `${120 + i * 90}ms` : '0ms',
                      transition:
                        'opacity 0.65s cubic-bezier(0.22, 1, 0.36, 1), filter 0.65s ease',
                      filter: active
                        ? 'drop-shadow(0 18px 28px rgba(0, 0, 0, 0.126)) drop-shadow(0 4px 6px rgba(0, 0, 0, 0.07))'
                        : 'drop-shadow(0 8px 14px rgba(0, 0, 0, 0.07))',
                      pointerEvents: 'none',
                      userSelect: 'none',
                      willChange: 'transform, opacity',
                    }}
                  />
                );
              })
            )}
          </div>
        );
      })()}

      {/* Floating notifications — one at a time on a calm rotation */}
      {!minimalUI && (() => {
        const phoneCx =
          layout === 'left' ? 'calc(28% + 60px)' :
          layout === 'right' ? 'calc(72% - 60px)' :
          '50%';
        const baseInOut: React.CSSProperties = {
          transition: 'opacity 0.7s ease, transform 0.8s cubic-bezier(0.22, 1, 0.36, 1)',
        };
        const visibleStyle = (visible: boolean): React.CSSProperties => ({
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(18px)',
        });
        return (
          <>
            {/* Chat bubble — top-left of phone (single message, avatar overlapping left edge) */}
            <div style={{
              position: 'absolute',
              top: layout === 'center' ? '38%' : '26%',
              left: `calc(${phoneCx} - 320px)`,
              width: 320,
              zIndex: 8,
              pointerEvents: 'none',
              fontFamily: '"Selecta", system-ui, -apple-system, sans-serif',
              ...baseInOut,
              ...visibleStyle(activeNotif === 'chat'),
            }}>
              <div style={{ animation: 'float-soft-a 4.6s ease-in-out infinite' }}>
                <div style={{
                  fontSize: 12,
                  color: '#9aa0a6',
                  marginLeft: 80,
                  marginBottom: 6,
                  fontWeight: 500,
                }}>Danny</div>
                <div style={{ position: 'relative', paddingLeft: 26 }}>
                  <img src="/facepile/avatar-2.png" alt="" style={{
                    position: 'absolute',
                    left: 0,
                    top: 4,
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    boxShadow: '0 0 0 2px #fff, 0 6px 14px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.042)',
                    zIndex: 2,
                  }} />
                  <div style={{
                    padding: '14px 20px 14px 36px',
                    borderRadius: 22,
                    background: '#fff',
                    color: '#1e1e1e',
                    fontSize: 15,
                    lineHeight: 1.32,
                    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.056), 0 2px 6px rgba(0, 0, 0, 0.028)',
                  }}>
                    I luv our new Barcelona trip planner mini-app <span aria-hidden="true">🫶🥺</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Like notification — bottom-right of phone */}
            <div style={{
              position: 'absolute',
              top: layout === 'center' ? 'auto' : '60%',
              bottom: layout === 'center' ? '18%' : 'auto',
              left: `calc(${phoneCx} - 40px)`,
              width: 340,
              zIndex: 8,
              pointerEvents: 'none',
              fontFamily: '"Selecta", system-ui, -apple-system, sans-serif',
              ...baseInOut,
              ...visibleStyle(activeNotif === 'like'),
            }}>
              <div style={{ position: 'relative', animation: 'float-soft-b 5.2s ease-in-out infinite' }}>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 22px 8px 8px',
                  background: '#fff',
                  borderRadius: 999,
                  boxShadow: '0 14px 36px rgba(0, 0, 0, 0.07), 0 2px 6px rgba(0, 0, 0, 0.042)',
                }}>
                  <div style={{ position: 'relative', width: 38, height: 38, flexShrink: 0 }}>
                    <img src="/facepile/avatar-4.png" alt="" style={{
                      width: '100%', height: '100%', objectFit: 'cover',
                      borderRadius: '50%', display: 'block',
                    }} />
                    <div style={{
                      position: 'absolute',
                      bottom: -3, right: -3,
                      width: 18, height: 18,
                      background: '#fff',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.056)',
                    }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#1e1e1e" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                      </svg>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                    <div style={{ fontSize: 13, color: '#1e1e1e' }}>
                      <span style={{ fontWeight: 600 }}>Veronica Maggio</span> liked your app
                    </div>
                    <div style={{ fontSize: 13, color: '#1e1e1e' }}>
                      Bedtime Stories <span style={{ color: '#9aa0a6', marginLeft: 4 }}>20m</span>
                    </div>
                  </div>
                </div>
                {/* 3D heart (rendered PNG from Figma) */}
                <img
                  src="/heart-3d.png"
                  alt=""
                  draggable={false}
                  style={{
                    position: 'absolute',
                    right: -38,
                    bottom: -54,
                    width: 90,
                    height: 90,
                    transform: 'rotate(8deg)',
                    filter: 'drop-shadow(0 10px 14px rgba(0, 0, 0, 0.126))',
                    animation: 'float-heart 5.6s ease-in-out infinite',
                    pointerEvents: 'none',
                    userSelect: 'none',
                  }}
                />
              </div>
            </div>
          </>
        );
      })()}

      {/* Floating QR — only in center layout; side layouts render it inside the text column.
          Hidden on mobile entirely (no real-world use case for scanning your own phone). */}
      {!minimalUI && layout === 'center' && !isMobile && (
        <div
          className="orb-qr-card blur-in"
          style={{
            animationDelay: '650ms',
            position: 'absolute',
            bottom: 'clamp(72px, 10vh, 110px)',
            right: 'clamp(20px, 3vw, 48px)',
            width: 'clamp(96px, 9vw, 132px)',
            aspectRatio: '1 / 1',
            padding: 'clamp(6px, 0.6vw, 9px)',
            borderRadius: 'clamp(14px, 1.6vw, 22px)',
            background: renderStyle === 'shaders' ? 'rgba(255, 255, 255, 0.385)' : 'rgba(255, 255, 255, 0.56)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: renderStyle === 'shaders'
              ? '1.5px solid rgba(255, 255, 255, 0.595)'
              : '1.5px solid rgba(0, 0, 0, 0.035)',
            boxShadow:
              '0 18px 17px rgba(0, 0, 0, 0.035), inset -1.8px -1.8px 1.8px rgba(0, 0, 0, 0.035), inset 1.8px 1.8px 1.8px rgba(0, 0, 0, 0.021), inset 0 0 12px rgba(0, 0, 0, 0.021)',
            zIndex: 20,
            cursor: 'pointer',
            transformOrigin: 'bottom right',
            transform: 'scale(1)',
            transition: 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          <img
            src="/qr-wabi.png"
            alt="QR code"
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }}
          />
        </div>
      )}

      {/* Collapsed panel — glass settings pill at the panel's CURRENT
          position (anchor top:84 left:16 + the shared panelOffset). Click to
          expand back into the full panel; drag to reposition. The pill and
          the expanded panel share `panelOffset` state so expanding always
          opens the panel in the exact spot it was last collapsed from. */}
      {showControls && !showcaseMode && panelCollapsed && (
        <CollapsedPanelPill
          panelOffset={panelOffset}
          setPanelOffset={setPanelOffset}
          onExpand={() => setPanelCollapsed(false)}
        />
      )}

      {/* Combined glassy control panel */}
      {showControls && !showcaseMode && !panelCollapsed && (() => {
        // ~30% more compact, ~40% more transparent. Tightened spacing,
        // smaller text, and stronger blur for the "frosted pane" feel.
        const sectionLabel: React.CSSProperties = {
          marginBottom: 5,
          fontWeight: 600,
          fontSize: 9,
          letterSpacing: 1.3,
          textTransform: 'uppercase',
          color: 'rgba(30, 30, 30, 0.294)',
        };
        const SECTION_GAP = 10;
        // Apple Liquid Glass segmented control — glassy track, glassy
        // dark "selected" pill with a subtle inner highlight + soft drop
        // shadow so the active option visually lifts off the track.
        const segGroup: React.CSSProperties = {
          display: 'flex',
          background: 'rgba(255, 255, 255, 0.315)',
          borderRadius: 10,
          padding: 3,
          gap: 0,
          border: '1px solid rgba(255, 255, 255, 0.385)',
          boxShadow:
            'inset 0 1px 2px rgba(0, 0, 0, 0.035), 0 0.5px 0 rgba(255, 255, 255, 0.42) inset',
          backdropFilter: 'blur(10px) saturate(160%)',
          WebkitBackdropFilter: 'blur(10px) saturate(160%)',
        };
        const segBtn = (active: boolean): React.CSSProperties => ({
          flex: 1,
          padding: '5px 6px',
          border: active ? '1px solid rgba(0, 0, 0, 0.455)' : '1px solid transparent',
          borderRadius: 7,
          background: active ? '#1e1e1e' : 'transparent',
          color: active ? '#fff' : 'rgba(30, 30, 30, 0.42)',
          fontSize: 11,
          fontWeight: active ? 600 : 500,
          textTransform: 'capitalize',
          cursor: 'pointer',
          transition:
            'background 0.22s cubic-bezier(0.5, 0, 0.2, 1), color 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease',
          fontFamily: 'inherit',
          boxShadow: active
            ? '0 1px 2px rgba(0, 0, 0, 0.175), inset 0 1px 0 rgba(255, 255, 255, 0.056), inset 0 -1px 0 rgba(0, 0, 0, 0.28)'
            : 'none',
        });
        const pillBtn = (active: boolean): React.CSSProperties => ({
          flex: 1,
          padding: '6px 10px',
          border: '1px solid rgba(0, 0, 0, 0.035)',
          borderRadius: 999,
          background: active ? '#1e1e1e' : 'rgba(255, 255, 255, 0.315)',
          color: active ? '#fff' : 'rgba(30, 30, 30, 0.546)',
          fontSize: 11,
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
          fontFamily: 'inherit',
        });

        // Apple Liquid Glass-style switch, black/white. ~36×20 with a
        // glassy track when off, charcoal track + white thumb when on.
        const Switch = ({ on, onChange, ariaLabel }: { on: boolean; onChange: (v: boolean) => void; ariaLabel?: string }) => (
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={ariaLabel}
            onClick={() => onChange(!on)}
            style={{
              width: 32,
              height: 18,
              borderRadius: 999,
              padding: 0,
              border: '1px solid rgba(0, 0, 0, 0.042)',
              background: on ? '#1e1e1e' : 'rgba(255, 255, 255, 0.385)',
              boxShadow: on
                ? 'inset 0 1px 2px rgba(0, 0, 0, 0.245), 0 0.5px 0 rgba(255, 255, 255, 0.385) inset'
                : 'inset 0 1px 2px rgba(0, 0, 0, 0.035), 0 0.5px 0 rgba(255, 255, 255, 0.49) inset',
              position: 'relative',
              cursor: 'pointer',
              transition: 'background 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease',
              flexShrink: 0,
              outline: 'none',
            }}
          >
            <span style={{
              position: 'absolute',
              top: 1,
              left: on ? 15 : 1,
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: '#fff',
              boxShadow: '0 1px 2.5px rgba(0, 0, 0, 0.196), 0 0.5px 0 rgba(0, 0, 0, 0.056)',
              transition: 'left 0.22s cubic-bezier(0.5, 0, 0.2, 1)',
            }} />
          </button>
        );

        // Inline label + switch on one row. Optional `hint` (small text like
        // "Loading…" / "R" / etc.) sits between the label and the switch.
        const SwitchRow = ({
          label, on, onChange, hint, hintColor,
        }: {
          label: string;
          on: boolean;
          onChange: (v: boolean) => void;
          hint?: React.ReactNode;
          hintColor?: string;
        }) => (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 26,
            marginBottom: SECTION_GAP - 2,
          }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: 8,
              fontWeight: 600,
              fontSize: 9,
              letterSpacing: 1.3,
              textTransform: 'uppercase',
              color: 'rgba(30, 30, 30, 0.385)',
            }}>
              {label}
              {hint != null && (
                <span style={{
                  textTransform: 'none',
                  letterSpacing: 0,
                  fontWeight: 500,
                  fontSize: 10,
                  color: hintColor ?? 'rgba(30, 30, 30, 0.35)',
                }}>{hint}</span>
              )}
            </span>
            <Switch on={on} onChange={onChange} ariaLabel={label} />
          </div>
        );
        // Drag handlers — attached DIRECTLY to the dedicated grip handle at
        // the top of the panel. Putting them on a real button-like element
        // (instead of the whole panel chrome) sidesteps a class of bugs
        // where preventDefault on the root swallowed clicks meant for inner
        // controls and React's event delegation got confused.
        const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
          // Only handle primary button (or touch/pen). Ignore right-click etc.
          if (e.button !== 0 && e.pointerType === 'mouse') return;
          e.currentTarget.setPointerCapture(e.pointerId);
          panelDragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            base: panelOffset,
          };
          setPanelDragging(true);
        };
        const onHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
          const d = panelDragRef.current;
          if (!d) return;
          setPanelOffset({
            x: d.base.x + (e.clientX - d.startX),
            y: d.base.y + (e.clientY - d.startY),
          });
        };
        const onHandleUp = (e: React.PointerEvent<HTMLDivElement>) => {
          if (!panelDragRef.current) return;
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            // Pointer may already have been released — ignore.
          }
          panelDragRef.current = null;
          setPanelDragging(false);
        };

        return (
          <div
            style={{
              position: 'absolute',
              // Pushed below the header CTA so the panel doesn't sit
              // directly under (and visually collide with) the Download
              // for iOS pill on the right side of the header.
              top: 132,
              right: 16,
              width: 224,
              // Bigger top padding to reserve room for the larger drag-grip
              // strip — gives the user a clear tap target above the
              // headline segmented control.
              padding: '34px 14px 14px',
              borderRadius: 18,
              background: 'rgba(255, 255, 255, 0.252)',
              backdropFilter: 'blur(36px) saturate(190%)',
              WebkitBackdropFilter: 'blur(36px) saturate(190%)',
              border: '1px solid rgba(255, 255, 255, 0.385)',
              boxShadow:
                '0 1px 0 rgba(255, 255, 255, 0.385) inset, 0 -1px 0 rgba(0, 0, 0, 0.021) inset, 0 20px 44px rgba(0, 0, 0, 0.07), 0 4px 12px rgba(0, 0, 0, 0.035)',
              color: '#1e1e1e',
              fontFamily: '"Selecta", system-ui, -apple-system, sans-serif',
              fontSize: 12,
              zIndex: 90,
              // Drag offset is passed through CSS vars so the panel-pop-in
              // keyframe can compose with it (the keyframe also writes
              // translate()).
              ['--po-x' as any]: `${panelOffset.x}px`,
              ['--po-y' as any]: `${panelOffset.y}px`,
              transform: `translate(${panelOffset.x}px, ${panelOffset.y}px)`,
              transition: panelDragging
                ? 'none'
                : 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)',
              // Smooth scale-in entrance, replacing the old blur-in fade.
              animation: 'panel-pop-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both',
              userSelect: 'none',
            }}
          >
            {/* Visible grip indicator — just a visual cue that the panel can
                be dragged. This element IS the drag target — pointer
                handlers live here directly, so click + drag are predictable.
                Beefed up to 34px tall + wide-pill grip so it's obvious. */}
            <div
              onPointerDown={onHandleDown}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              onPointerCancel={onHandleUp}
              role="separator"
              aria-label="Drag controls panel"
              title="Drag to move"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                // Leave a 36px slot on the right for the collapse button so
                // the handle never overlaps it. Without this gap the grip's
                // pointer-capture would steal mousedown from the X button.
                right: 36,
                height: 34,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: panelDragging ? 'grabbing' : 'grab',
                touchAction: 'none',
                userSelect: 'none',
                borderTopLeftRadius: 18,
                // The handle sits ABOVE the inner controls so its
                // pointer-capture wins over any element it visually overlaps.
                zIndex: 3,
              }}
            >
              <span style={{
                width: 48,
                height: 5,
                borderRadius: 999,
                background: panelDragging
                  ? 'rgba(30, 30, 30, 0.55)'
                  : 'rgba(30, 30, 30, 0.4)',
                pointerEvents: 'none',
                transition: 'background 0.2s ease',
              }} />
            </div>
            {/* Collapse button — top-right of the panel. Mirrors the pill
                that appears when collapsed. */}
            <button
              type="button"
              onClick={() => setPanelCollapsed(true)}
              aria-label="Collapse controls"
              title="Collapse"
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                width: 26,
                height: 26,
                border: 0,
                borderRadius: 8,
                background: 'rgba(0, 0, 0, 0.035)',
                color: 'rgba(30, 30, 30, 0.49)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
                transition: 'background 0.18s ease',
                // Ensure the collapse button sits ABOVE the drag handle so
                // its click isn't swallowed by the grip strip.
                zIndex: 2,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0, 0, 0, 0.07)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0, 0, 0, 0.035)')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
              </svg>
            </button>

            {/* Headline — segmented control for which copy variant runs.
                'short' = personalMode ON ("Make it personal" hero).
                'long'  = personalMode OFF ("Personal software for you and
                          your friends" hero). */}
            <div style={sectionLabel}>Headline</div>
            <div style={{ ...segGroup, marginBottom: SECTION_GAP }}>
              {([
                ['short', personalMode],
                ['long', !personalMode],
              ] as const).map(([label, active]) => (
                <button
                  key={label}
                  onClick={() => {
                    const isShort = label === 'short';
                    setPersonalMode(isShort);
                    // Switching to LONG headline auto-enables orbs +
                    // bumps the lever to cyclone if it was at 0 — the
                    // longer headline layout reads better with the
                    // orbital cloud carrying the right side.
                    if (!isShort) {
                      setShowOrbs(true);
                      if (leverStateRef.current === 0) {
                        leverStateRef.current = 1;
                        setLeverState(1);
                        setMode('cyclone');
                      }
                    }
                  }}
                  style={segBtn(active)}
                >{label}</button>
              ))}
            </div>

            {/* Layout */}
            <div style={sectionLabel}>Layout</div>
            <div style={{ ...segGroup, marginBottom: SECTION_GAP }}>
              {(['left', 'center', 'right'] as const).map(l => (
                <button
                  key={l}
                  onClick={() => {
                    setLayout(l);
                    // Center layout reads best with profile avatars +
                    // orbs both turned on (the centered hero leans on
                    // those for visual interest). Side layouts leave
                    // user prefs alone.
                    if (l === 'center') {
                      setShowProfiles(true);
                      setShowOrbs(true);
                      if (leverStateRef.current === 0) {
                        leverStateRef.current = 1;
                        setLeverState(1);
                        setMode('cyclone');
                      }
                    }
                  }}
                  style={segBtn(layout === l)}
                >{l}</button>
              ))}
            </div>

            {/* Motion — Orbit + Shapes options removed by request. Only
                physics (drop) and cyclone (orbit-around-phone) remain. */}
            <div style={sectionLabel}>Motion</div>
            <div style={{ ...segGroup, marginBottom: SECTION_GAP, flexWrap: 'wrap' }}>
              {(['physics', 'cyclone'] as const).map(m => (
                <button key={m} onClick={() => setMode(m)} style={segBtn(displayMode === m)}>{m}</button>
              ))}
            </div>

            {/* Inline Apple-style switch rows for everything binary. */}
            <SwitchRow label="Orbs"      on={showOrbs}          onChange={setShowOrbs} />
            <SwitchRow label="Fan out"   on={showProfiles}      onChange={setShowProfiles} />
            <SwitchRow label="Floats"    on={showNotifications} onChange={setShowNotifications} />
            <SwitchRow label="3D icons"  on={showPersonaProps}  onChange={setShowPersonaProps} />
            {/* ("Make it personal" toggle removed — replaced by the
                Headline short/long segmented control at the top of the panel.) */}
            {/* Cycling-word icon — only meaningful in personalMode (it's the
                little inline 3D icon before the rotating adjective). */}
            <SwitchRow
              label="Cycling icon"
              on={showCyclingIcon}
              onChange={setShowCyclingIcon}
            />
            {/* (Bento + Focus rows removed from the panel — bento section
                deleted entirely; focus is still flipped internally by the
                hand-mode cascade but no longer surfaced as a user switch.) */}

            {/* (Playground launcher removed from the panel — showcaseMode
                is still wired up internally, just no UI to enter it.) */}

            {/* (Joystick sound options removed from the panel — the
                joystickSound state stays at its 'lever' default, which is
                still piped into the <Joystick> component.) */}

            {/* (Generate-orb UI removed from the panel — the /api/generate-orb
                endpoint + generateOrb handler are still wired up, just no
                input/button surfaced anymore.) */}

            {/* (Damping slider removed from the panel — `damping` state is
                still wired up internally so orbs feel correct, just no UI
                to adjust it.) */}

            {/* Orb size — only meaningful when orbs are visible, so the
                whole row hides itself when Orbs is toggled off. */}
            {showOrbs && (
              <>
                <div style={sectionLabel}>
                  <span style={{ display: 'inline-flex', justifyContent: 'space-between', width: '100%' }}>
                    <span>Orb size</span>
                    <span style={{ opacity: 0.7 }}>{orbSize.toFixed(1)}x</span>
                  </span>
                </div>
                <input
                  type="range" min="0.3" max="2.0" step="0.1"
                  value={orbSize} onChange={(e) => setOrbSize(parseFloat(e.target.value))}
                  style={{ width: '100%', cursor: 'pointer', accentColor: '#1e1e1e' }}
                />
              </>
            )}

            {/* Reset — same action as the clap gesture, just a button. Press
                R for the keyboard shortcut. */}
            <div style={{ ...sectionLabel, marginTop: SECTION_GAP + 4 }}>
              <span style={{ display: 'inline-flex', justifyContent: 'space-between', width: '100%' }}>
                <span>Reset</span>
                <span style={{ opacity: 0.55, textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>R</span>
              </span>
            </div>
            <button
              onClick={resetOrbs}
              style={{ ...pillBtn(true), width: '100%' }}
            >Drop fresh orbs</button>

            {/* ─── Hand mode (camera + core gestures + focus, all in one toggle) ───
                Sits at the very bottom of the panel. Flipping On gives you the
                full experience: webcam preview with skeleton overlay, open palm
                / fist / clap / palm-height gestures, and Focus mode so the rest
                of the page gets out of the way. Off restores the landing. */}
            <div style={{
              marginTop: SECTION_GAP + 4,
              marginBottom: SECTION_GAP,
              height: 1,
              background: 'linear-gradient(to right, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.056) 20%, rgba(0, 0, 0, 0.056) 80%, rgba(0, 0, 0, 0) 100%)',
            }} />
            <SwitchRow
              label="Hand mode"
              on={handMode}
              hint={
                handStatus === 'loading' ? 'Loading…'
                : handStatus === 'denied'  ? 'Denied'
                : handStatus === 'error'   ? 'Error'
                : null
              }
              hintColor={handStatus === 'denied' || handStatus === 'error' ? '#b91c1c' : undefined}
              onChange={(v) => {
                if (v) {
                  // Enter Hand mode: turn EVERYTHING on in one click —
                  // camera + core gestures + Focus + orbs (otherwise
                  // the user enters a mode that controls orbs but
                  // can't see any). Lever also bumped to state 1
                  // (cyclone) so there's a visible cyclone for the
                  // gestures to act on.
                  setHandMode(true);
                  setHandControl(true);
                  setFocusMode(true);
                  setShowOrbs(true);
                  if (leverStateRef.current === 0) {
                    leverStateRef.current = 1;
                    setLeverState(1);
                    setMode('cyclone');
                  }
                } else {
                  // Exit: kill camera + restore the landing. Skeleton +
                  // camera-size preferences are kept across cycles.
                  setHandMode(false);
                  setHandControl(false);
                  setFocusMode(false);
                }
              }}
            />

            {/* Sub-controls — only shown once Hand mode is on */}
            {handMode && (
              <>
                {/* Camera size — S / M / L / XL segmented control */}
                <div style={{ ...sectionLabel, marginTop: 4 }}>Camera size</div>
                <div style={{ ...segGroup, marginBottom: 8 }}>
                  {(['s', 'm', 'l', 'xl'] as const).map(s => (
                    <button key={s} onClick={() => setHandCameraSize(s)} style={segBtn(handCameraSize === s)}>
                      {s.toUpperCase()}
                    </button>
                  ))}
                </div>

                {/* Tracking — show live hand skeleton on the feed */}
                <SwitchRow label="Tracking" on={handShowSkeleton} onChange={setHandShowSkeleton} />
              </>
            )}
          </div>
        );
      })()}

      {/* (Helper text "Click to drop · Tap orb to view · Press D for controls"
          removed — the controls panel + joystick make the affordances
          discoverable without it, and on small screens it competed with the
          headline. Left the comment as a breadcrumb in case we ever want it
          back behind a debug flag.) */}

      {/* (Scroll-down chevron removed along with the bento section.) */}

      </section>
      {/* End hero section */}

      {/* Playground chrome — visible only when in showcase/playground mode.
          A floating glass "Exit" pill bottom-center plus a small bottom-left
          gesture cheatsheet so users know what their hands can do. */}
      {showcaseMode && (
        <>
          <button
            type="button"
            onClick={() => setShowcaseMode(false)}
            style={{
              position: 'fixed',
              bottom: 24,
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '10px 18px',
              border: '1px solid rgba(255, 255, 255, 0.385)',
              borderRadius: 999,
              background: 'rgba(255, 255, 255, 0.294)',
              backdropFilter: 'blur(28px) saturate(180%)',
              WebkitBackdropFilter: 'blur(28px) saturate(180%)',
              boxShadow: '0 18px 40px rgba(0, 0, 0, 0.084), 0 4px 10px rgba(0, 0, 0, 0.042)',
              color: '#1e1e1e',
              fontFamily: '"Selecta", system-ui, -apple-system, sans-serif',
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: 0.3,
              cursor: 'pointer',
              zIndex: 110,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ opacity: 0.6, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.2 }}>esc</span>
            Exit playground
          </button>

        </>
      )}

      {/* Gesture toolbar — bottom-center, only when Hand mode is on. The
          toolbar itself manages its own expanded/minimized/dismissed state. */}
      <HandToolbar enabled={handMode} />


      {/* Card Modal — glassy "App card" style (matches Figma 30:6880) */}
      {selectedOrb && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            // Wider, semi-transparent white-ish blur (not dark)
            background: 'rgba(255, 255, 255, 0.245)',
            backdropFilter: 'blur(40px) saturate(160%)',
            WebkitBackdropFilter: 'blur(40px) saturate(160%)',
            opacity: isClosing ? 0 : 1,
            transition: isClosing ? 'opacity 0.4s ease' : 'none',
            padding: '2rem',
          }}
          onClick={handleCloseCard}
        >
          <div
            className={isClosing ? 'card-exit' : 'card-enter'}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              width: 'min(420px, 100%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
              padding: '40px 24px 28px',
              borderRadius: 42,
              background: 'rgba(255, 255, 255, 0.546)',
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)',
              boxShadow:
                '0 14px 70px rgba(0, 0, 0, 0.14), inset 1px 1px 1px rgba(255, 255, 255, 0.224), inset -1px -1px 1px rgba(0, 0, 0, 0.042)',
              fontFamily: '"Selecta", system-ui, -apple-system, sans-serif',
            }}
          >
            {/* Close button (top-left) */}
            <button
              aria-label="Close"
              onClick={handleCloseCard}
              style={{
                position: 'absolute',
                top: 18,
                left: 18,
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'rgba(0, 0, 0, 0.028)',
                border: 0,
                cursor: 'pointer',
                padding: 0,
                color: '#1e1e1e',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.2s ease, transform 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.056)';
                e.currentTarget.style.transform = 'scale(1.06)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.028)';
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>

            {/* Share icon top-right */}
            <button
              aria-label="Share"
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: 22,
                right: 22,
                background: 'transparent',
                border: 0,
                cursor: 'pointer',
                padding: 6,
                color: '#1e1e1e',
                opacity: 0.8,
                transition: 'opacity 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.8'; }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </button>

            {/* Profile picture (the orb's image) + username pill */}
            <div style={{ position: 'relative', width: 92, height: 92 }}>
              <div
                className="orb-appear"
                style={{
                  width: 92,
                  height: 92,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  border: '2px solid rgba(0, 0, 0, 0.056)',
                  boxShadow:
                    '0 8px 16px rgba(0, 0, 0, 0.07), 0 4px 12px rgba(0, 0, 0, 0.028), 0 0 0 1px rgba(0, 0, 0, 0.014)',
                  position: 'relative',
                }}
              >
                <img
                  src={selectedOrb.data.imageUrl}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
                <img
                  src="/orb-overlay.png"
                  alt=""
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                  }}
                />
              </div>
              {/* Username pill */}
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  bottom: -10,
                  transform: 'translateX(-50%)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 10px 5px 5px',
                  borderRadius: 999,
                  background: 'rgba(255, 255, 255, 0.385)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  boxShadow: '0 5px 25px rgba(0, 0, 0, 0.042), inset 0 0 0 0.5px rgba(255, 255, 255, 0.42)',
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #f0a868, #b3563a)',
                    border: '1px solid #fff',
                    display: 'inline-block',
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 500, color: '#0a0a0a', letterSpacing: '-0.005em' }}>
                  {selectedOrb.data.username}
                </span>
              </div>
            </div>

            {/* Title + description */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginTop: 8, textAlign: 'center' }}>
              <h2 style={{
                margin: 0,
                fontFamily: 'inherit',
                fontWeight: 500,
                fontSize: 26,
                lineHeight: '32px',
                color: '#1e1e1e',
                letterSpacing: '-0.01em',
              }}>
                {selectedOrb.data.appTitle}
              </h2>
              <p style={{
                margin: 0,
                fontFamily: 'inherit',
                fontWeight: 400,
                fontSize: 17,
                lineHeight: '22px',
                color: '#424242',
                maxWidth: 280,
              }}>
                A delightful mini-app made on Wabi. Scan the QR to try it out.
              </p>
            </div>

            {/* Stats row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#525252', fontSize: 14 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
                160
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 4v6.5L3 14v2h7l1 6 1-6h7v-2l-6-3.5V4" />
                </svg>
                160
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
                12
              </span>
            </div>

            {/* Action buttons row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 4, width: '100%' }}>
              {/* "Open" — dark pill */}
              <a
                href={appLink || '#'}
                target={appLink ? '_blank' : undefined}
                rel="noopener noreferrer"
                onClick={(e) => { if (!appLink) e.preventDefault(); }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  height: 52,
                  padding: '0 22px',
                  borderRadius: 60,
                  background: 'linear-gradient(to top, #0a0a0a, #4a4a4a)',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 500,
                  textDecoration: 'none',
                  fontFamily: 'inherit',
                  boxShadow:
                    'inset -1px -1px 2px rgba(255, 255, 255, 0.224), inset 1px 1px 1px rgba(255, 255, 255, 0.084), 0 4px 12px rgba(0, 0, 0, 0.105)',
                  transition: 'transform 0.2s ease',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(0.97)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                  <circle cx="8.5" cy="11.5" r="0.8" fill="currentColor" />
                  <circle cx="12" cy="11.5" r="0.8" fill="currentColor" />
                  <circle cx="15.5" cy="11.5" r="0.8" fill="currentColor" />
                </svg>
                Open
              </a>
              {/* Heart */}
              <button
                aria-label="Like"
                onClick={(e) => e.stopPropagation()}
                style={iconCircleBtn()}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1e1e1e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </button>
              {/* Bell */}
              <button
                aria-label="Notify"
                onClick={(e) => e.stopPropagation()}
                style={iconCircleBtn()}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1e1e1e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              </button>
              {/* Pin */}
              <button
                aria-label="Pin"
                onClick={(e) => e.stopPropagation()}
                style={iconCircleBtn()}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1e1e1e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 17v5" />
                  <path d="M9 10.76L12 2l3 8.76L18 14H6L9 10.76z" />
                  <line x1="3" y1="3" x2="21" y2="21" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Joystick — toggles between physics (drop) and cyclone (formation).
          Desktop: rendered HERE as a fixed-position element bottom-left.
          Mobile: passed as Footer's leftSlot below so it flows inline with
          the (non-sticky) footer instead of floating at the page edge. */}
      {!showcaseMode && !isMobile && (
        <Joystick
          sound={joystickSound}
          pulled={leverState > 0}
          extraPull={leverState === 2}
          onToggle={toggleLever}
        />
      )}

      {/* Hand-control mode — camera + MediaPipe. Mounting toggles the camera.
          Works in playground (showcase) mode too — the gestures are the whole
          point there. */}
      <HandControl
        enabled={handControl}
        size={handCameraSize}
        showSkeleton={handShowSkeleton}
        layoutMode={handLayoutMode}
        splitSide={handSplitSide}
        onChangeLayoutMode={setHandLayoutMode}
        onChangeSplitSide={setHandSplitSide}
        onStatus={setHandStatus}
        onClap={() => resetOrbs()}
        onHandPosition={(pos) => {
          if (!pos) return;
          // Mirror what the cursor parallax does: map normalized 0..1 → -1..1.
          mouseTiltTargetRef.current.x = Math.max(-1, Math.min(1, pos.x * 2 - 1));
          mouseTiltTargetRef.current.y = Math.max(-1, Math.min(1, pos.y * 2 - 1));
        }}
        onGesture={(g) => {
          // Open palm → cyclone (orbs reform). Closed fist → physics (drop).
          if (g === 'open' && displayModeForToggleRef.current !== 'cyclone') {
            setMode('cyclone');
          } else if (g === 'fist' && displayModeForToggleRef.current !== 'physics') {
            setMode('physics');
          }
        }}
        onPalmHeight={(y) => {
          // One-hand open palm height drives the cyclone radius.
          // y=0 (hand at top) → 2.8x (wide). y=1 (hand at bottom) → 0.15x
          // (orbs pinch into a tiny cluster). y=0.5 → ~1.4x.
          // Released (null) → snap back to 1.0.
          if (y == null) {
            cycloneRadiusMulTargetRef.current = 1.0;
          } else {
            const mul = 2.8 - y * 2.65;
            cycloneRadiusMulTargetRef.current = Math.max(0.15, Math.min(2.8, mul));
          }
        }}
        onHandsTilt={(t) => {
          // Two-hand tilt → cyclone's orbital plane tilt. Null means hands
          // are no longer both visible → relax back to no extra tilt.
          handsTiltTargetRef.current = t ?? 0;
        }}
        onHandsDistance={(d) => {
          // BOTH hands visible: distance between them drives the cyclone size.
          // Distance is normalized in MediaPipe's space; observed range is
          // roughly 0.05 (hands touching) to ~1.0 (hands at the edges of frame).
          // Map to a radius multiplier of 0.10x (barely visible) to 2.8x (huge).
          if (d == null) {
            // Released → only snap back if palm-height isn't also driving the
            // value (palm-height handler will keep its own value alive).
            cycloneRadiusMulTargetRef.current = 1.0;
            return;
          }
          // Clamp + remap. Tight curve near 0 so "very close" gets very small.
          const t = Math.max(0, Math.min(1, (d - 0.05) / 0.9));
          const mul = 0.10 + Math.pow(t, 0.85) * (2.8 - 0.10);
          cycloneRadiusMulTargetRef.current = mul;
        }}
        onPinch={(pos) => {
          // Spawn a fresh orb at the pinch point (normalized 0..1 → pixels).
          const x = pos.x * window.innerWidth;
          addOrb(x);
        }}
      />

      {/* "Manifesto unlocking..." toast — fades in on M key press, hangs
          out for 3s, then the page navigates to the manifesto subdomain. */}
      {manifestoUnlocking && (
        <div
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '12px 20px',
            borderRadius: 999,
            background: 'rgba(20, 20, 20, 0.602)',
            color: '#fff',
            fontFamily: '"Selecta", system-ui, -apple-system, sans-serif',
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: 0.3,
            backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            border: '1px solid rgba(255, 255, 255, 0.084)',
            boxShadow: '0 18px 36px rgba(0, 0, 0, 0.154), 0 4px 12px rgba(0, 0, 0, 0.084)',
            zIndex: 200,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            animation: 'manifesto-toast-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
          }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#7cffaa',
            boxShadow: '0 0 12px rgba(124, 255, 170, 0.455)',
            animation: 'manifesto-dot-pulse 1.2s ease-in-out infinite',
          }} />
          Manifesto unlocking…
        </div>
      )}
      <style>{`
        @keyframes manifesto-toast-in {
          0%   { opacity: 0; transform: translate(-50%, 16px); filter: blur(6px); }
          100% { opacity: 1; transform: translate(-50%, 0);    filter: blur(0); }
        }
        @keyframes manifesto-dot-pulse {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50%      { opacity: 1;   transform: scale(1.25); }
        }
      `}</style>

      {/* Footer (fixed bottom) */}
      {!minimalUI && (
        <Footer
          leftSlot={
            isMobile && !showcaseMode ? (
              <Joystick
                sound={joystickSound}
                pulled={leverState > 0}
                extraPull={leverState === 2}
                onToggle={toggleLever}
                inline
              />
            ) : undefined
          }
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * CollapsedPanelPill — minimized-in-place version of the controls panel.
 *   - Shares the parent's `panelOffset` state, so the pill sits at the SAME
 *     screen position the panel was at when the user collapsed it (anchor
 *     `top: 84; left: 16` + the shared delta). Expand → panel reopens in
 *     the same spot.
 *   - Click to expand; drag to reposition. Click vs drag disambiguated by
 *     total pointer movement (<4px = click).
 * ------------------------------------------------------------------------- */
function CollapsedPanelPill({
  panelOffset,
  setPanelOffset,
  onExpand,
}: {
  panelOffset: { x: number; y: number };
  setPanelOffset: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  onExpand: () => void;
}) {
  const dragRef = useRef<{
    startX: number;
    startY: number;
    base: { x: number; y: number };
    moved: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      base: panelOffset,
      moved: 0,
    };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    d.moved = Math.max(d.moved, Math.hypot(dx, dy));
    setPanelOffset({ x: d.base.x + dx, y: d.base.y + dy });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    const wasClick = d.moved < 4;
    dragRef.current = null;
    setDragging(false);
    if (wasClick) onExpand();
  };

  return (
    <button
      type="button"
      aria-label="Expand controls"
      title="Controls"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        // Same anchor as the expanded panel so the two share a position.
        // Panel default anchors to top-right below the header CTA; the
        // pill matches so they collapse/expand in place.
        position: 'absolute',
        top: 132,
        right: 16,
        width: 44,
        height: 44,
        border: '1px solid rgba(255, 255, 255, 0.385)',
        borderRadius: 14,
        background: 'rgba(255, 255, 255, 0.294)',
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        boxShadow: '0 10px 24px rgba(0, 0, 0, 0.07), 0 4px 8px rgba(0, 0, 0, 0.042)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: dragging ? 'grabbing' : 'grab',
        zIndex: 95,
        padding: 0,
        // Drag offset passed through CSS vars so the same panel-pop-in
        // keyframe can scale + fade in over a translated start position.
        ['--po-x' as any]: `${panelOffset.x}px`,
        ['--po-y' as any]: `${panelOffset.y}px`,
        transform: `translate(${panelOffset.x}px, ${panelOffset.y}px)`,
        transition: dragging ? 'none' : 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
        animation: 'panel-pop-in 0.26s cubic-bezier(0.22, 1, 0.36, 1) both',
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      {/* Sliders icon (matches the controls metaphor) */}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1e1e1e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="4"  y1="6"  x2="20" y2="6" />
        <line x1="4"  y1="12" x2="20" y2="12" />
        <line x1="4"  y1="18" x2="20" y2="18" />
        <circle cx="9"  cy="6"  r="2.2" fill="#1e1e1e" />
        <circle cx="15" cy="12" r="2.2" fill="#1e1e1e" />
        <circle cx="7"  cy="18" r="2.2" fill="#1e1e1e" />
      </svg>
    </button>
  );
}

export default App;
