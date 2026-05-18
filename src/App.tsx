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
  const [damping, setDamping] = useState(0.005);
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
  // Which synthesized joystick sound to use ("lever" was the original).
  const [joystickSound, setJoystickSound] = useState<JoystickSound>('lever');
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

      // Play area: full viewport width, with footer clearance
      const wallThickness = 50;
      const FOOTER_CLEARANCE = 72;
      const playRight = window.innerWidth;
      const floorY = window.innerHeight - FOOTER_CLEARANCE;
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
        const _phoneXFrac = _layout === 'left' ? 0.28 : _layout === 'right' ? 0.72 : 0.5;
        const _phoneXOffset = _layout === 'left' ? 60 : _layout === 'right' ? -60 : 0;
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
        const _mobilePersonal = _mobile && _pm;
        const _phoneXFrac = _mobilePersonal
          ? 0.5
          : _splitting
            ? (_splitSide === 'right' ? 0.25 : 0.75)
            : _orbsOnly
              ? 0.5
              : _layout === 'left'
                ? (_pm ? 0.34 : 0.28)
                : _layout === 'right'
                  ? (_pm ? 0.66 : 0.72)
                  : 0.5;
        const _phoneXOffset = _mobilePersonal || _orbsOnly || _splitting
          ? 0
          : _layout === 'left'
            ? (_pm ? 40 : 60)
            : _layout === 'right'
              ? (_pm ? -40 : -60)
              : 0;
        const centerX = window.innerWidth * _phoneXFrac + _phoneXOffset;
        const _phoneHcalc = _layout === 'center'
          ? Math.max(390, Math.min(700, window.innerHeight * 0.63))
          : Math.max(420, Math.min(720, window.innerHeight * 0.72));
        // Mobile personalMode: phone fully visible, bottom flush with the
        // viewport bottom (`bottom: 0; translateY(0%)`). That puts the phone
        // CENTER at `viewport_bottom - 0.5 * phoneHeight`, so the cyclone
        // center has to match exactly.
        const _mobilePhoneH = Math.max(364, Math.min(494, window.innerHeight * 0.598));
        const centerY = _mobilePersonal
          ? window.innerHeight - _mobilePhoneH * 0.5
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
            // Mobile personalMode scales the phone 30% larger — bump cyclone
            // radius the same so the orbital cloud still hugs the device.
            const mobilePersonalBump = _mobilePersonal ? 1.3 : 1;
            // Final -10% pass so the cloud feels snug around the phone.
            const baseR = Math.min(minR, maxR) * mobilePersonalBump * 0.9;
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
            // TILT = base 1.25 rad (~72°) + cursor/single-hand Y nudge
            // (now ±0.45 rad ≈ ±26°, was ±10°) + two-hand angle (±0.7 rad ≈
            // ±40°). Single hand still gets a felt nudge; two hands let you
            // tilt the orbital plane far.
            const TILT = 1.25 + mtY * 0.45 + handsTiltRef.current * 0.7;
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
            haloGrad.addColorStop(0, 'rgba(255,255,255,0.9)');
            haloGrad.addColorStop(0.55, 'rgba(200,235,255,0.45)');
            haloGrad.addColorStop(0.85, 'rgba(255,200,235,0.18)');
            haloGrad.addColorStop(1, 'rgba(255,255,255,0)');
            tctx.fillStyle = haloGrad;
            tctx.beginPath();
            tctx.arc(0, 0, halo, 0, Math.PI * 2);
            tctx.fill();

            const coreGrad = tctx.createRadialGradient(-radius * 0.15, -radius * 0.2, 0, 0, 0, radius);
            coreGrad.addColorStop(0, 'rgba(255,255,255,1)');
            coreGrad.addColorStop(0.55, 'rgba(245,252,255,0.95)');
            coreGrad.addColorStop(0.85, 'rgba(180,220,255,0.55)');
            coreGrad.addColorStop(1, 'rgba(140,180,255,0)');
            tctx.fillStyle = coreGrad;
            tctx.beginPath();
            tctx.arc(0, 0, radius, 0, Math.PI * 2);
            tctx.fill();

            tctx.lineWidth = Math.max(1, radius * 0.04);
            tctx.strokeStyle = 'rgba(255,200,230,0.35)';
            tctx.beginPath();
            tctx.arc(0, 0, radius * 0.97, 0, Math.PI * 2);
            tctx.stroke();
            tctx.strokeStyle = 'rgba(170,230,255,0.35)';
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

        // Update wall positions immediately (play area = full width, with footer clearance)
        const FOOTER_CLEARANCE_R = 72;
        const playRightR = window.innerWidth;
        const floorYR = window.innerHeight - FOOTER_CLEARANCE_R;
        Matter.Body.setPosition(walls[0], { x: playRightR / 2, y: floorYR + wallThickness / 2 });
        Matter.Body.setPosition(walls[1], { x: -wallThickness / 2, y: window.innerHeight / 2 });
        Matter.Body.setPosition(walls[2], { x: playRightR + wallThickness / 2, y: window.innerHeight / 2 });

        // DEBOUNCED: Reposition orbs after resize settles (prevents glitchy physics)
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = window.setTimeout(() => {
          if (displayModeRef.current === 'physics') {
            const orbs = Matter.Composite.allBodies(engine.world).filter(b => b.label === 'orb');
            const floorY = window.innerHeight - 72;

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
            0 30px 50px rgba(0,0,0,0.12),
            0 12px 20px rgba(0,0,0,0.06),
            inset -1.8px -1.8px 1.8px rgba(0,0,0,0.05),
            inset 1.8px 1.8px 1.8px rgba(0,0,0,0.03),
            inset 0 0 12px rgba(0,0,0,0.03) !important;
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

      {/* Hero section (100vh) — contains the canvases, phone, headline, panels */}
      <section style={{
        position: 'relative',
        width: '100%',
        height: '100vh',
        overflow: 'hidden',
      }}>

      {/* Back canvas: orbs behind the phone */}
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onTouchStart={handleCanvasTouch}
        style={{ display: 'block', cursor: 'pointer', touchAction: 'none', position: 'absolute', inset: 0, zIndex: 1 }}
      />

      {/* Front canvas: orbs in front of the phone (passthrough pointer events) */}
      <canvas
        ref={canvasFrontRef}
        style={{ display: 'block', position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}
      />

      {/* Header (fixed top) */}
      {!minimalUI && <Header />}

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
                  // Mobile: stack copy at the top, centered.
                  top: 'clamp(96px, 14vh, 140px)',
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
            : layout === 'center'
            ? {
                top: 'clamp(110px, 12vh, 140px)',
                left: '50%',
                transform: 'translateX(-50%)',
                width: 'min(900px, 94vw)',
                textAlign: 'center' as const,
              }
            : {
                top: '50%',
                transform: 'translateY(-50%)',
                [layout === 'left' ? 'right' : 'left']: 'clamp(110px, 10vw, 200px)',
                width: 'min(440px, 34vw)',
                textAlign: 'center' as const,
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
              // Non-personal headlines bumped +25% (center was
              // clamp(18,2.56vw,38), side was clamp(15,2.05vw,30)).
              : layout === 'center'
              ? 'clamp(23px, 3.2vw, 48px)'
              : 'clamp(19px, 2.56vw, 38px)',
            lineHeight: personalMode ? 0.98 : 1.11,
            letterSpacing: '-0.01em',
            fontWeight: 400,
            margin: 0,
            marginBottom: 'clamp(20px, 1.4vh, 30px)',
            fontFeatureSettings: '"dlig" 1',
            animationDelay: '120ms',
          }}>
            {(() => {
              const ids = [1, 2, 3, 4];
              const selectedId = (activePhone % 4) + 1;
              const ordered = [selectedId, ...ids.filter((id) => id !== selectedId)];
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
                      'drop-shadow(0 8px 14px rgba(0,0,0,0.12)) drop-shadow(0 40px 80px rgba(0,0,0,0.32))',
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
            // #f0f0f0). Was rgba(99,99,99,0.95) ≈ #6A6A6A — too dark.
            color: renderStyle === 'shaders' ? 'rgba(255,255,255,0.75)' : 'rgba(99,99,99,0.7)',
            margin: 0,
            maxWidth: personalMode ? 'none' : 400,
            // In personalMode the wrapper is already left-aligned and width-
            // constrained; no auto-centering on this <p>.
            marginLeft: personalMode ? 0 : 'auto',
            marginRight: personalMode ? 0 : 'auto',
            marginTop: personalMode ? 'clamp(36px, 4vh, 60px)' : 0,
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
          {layout !== 'center' && !(isMobile && personalMode) && (
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
                // above), so we have just left vs right vs mobile here. The
                // center-layout QR lives in its own floating block below.
                margin: personalMode
                  ? (isMobile
                      ? 'clamp(28px, 3.5vh, 48px) auto 0'
                      : layout === 'left'
                      // Phone-on-left → copy on the right → QR right-aligned.
                      ? 'clamp(44px, 5.5vh, 80px) 0 0 auto'
                      // Phone-on-right (default) → copy on the left → QR left-aligned.
                      : 'clamp(44px, 5.5vh, 80px) 0 0')
                  : 'clamp(20px, 2.5vh, 36px) auto 0',
                transformOrigin: personalMode && !isMobile
                  ? (layout === 'left' ? 'top right' : 'top left')
                  : 'top center',
                background: renderStyle === 'shaders' ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.8)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                border: renderStyle === 'shaders'
                  ? '1.5px solid rgba(255,255,255,0.85)'
                  : '1.5px solid rgba(0,0,0,0.05)',
                boxShadow:
                  '0 18px 17px rgba(0,0,0,0.05), inset -1.8px -1.8px 1.8px rgba(0,0,0,0.05), inset 1.8px 1.8px 1.8px rgba(0,0,0,0.03), inset 0 0 12px rgba(0,0,0,0.03)',
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
              // Mobile personal: phone is anchored to the viewport bottom
              // fully visible (no translateY tuck-below). This is the
              // highest position before it would start overlapping copy on
              // a typical phone viewport.
              position: 'absolute',
              left: '50%',
              bottom: 0,
              transform: 'translate(-50%, 0%)',
              height: 'clamp(364px, 59.8vh, 494px)',
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
        return <DraggableProps wrapperStyle={wrapperStyle} hidden={showOrbs} />;
      })()}

      {/* Phone carousel — three dashboards, click to cycle which is in front */}
      {!minimalUI && (() => {
        const PHONE_SOURCES = ['/dash-1.png', '/dash-2.png', '/dash-3.png'];
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

        return (
          <div
            className="blur-in-fixed"
            onClick={() => {
              if (showProfiles) setActivePhone((p) => (p + 1) % 3);
            }}
            style={{
              animationDelay: '400ms',
              position: 'absolute',
              // Mobile + personalMode: phone bottom anchored to viewport
              // bottom, fully visible (was translateY 20% tucked-below).
              ...(isMobile && personalMode
                ? {
                    left: '50%',
                    bottom: 0,
                    transform: 'translate(-50%, 0%)',
                    height: 'clamp(364px, 59.8vh, 494px)',
                  }
                // Mobile + non-personal (centered) layout: same treatment —
                // bottom-anchored, fully visible. Slightly smaller height
                // clamp than personal because the centered headline + CTA
                // need more vertical room above the phone.
                : isMobile && layout === 'center'
                ? {
                    left: '50%',
                    bottom: 0,
                    transform: 'translate(-50%, 0%)',
                    height: 'clamp(320px, 52vh, 440px)',
                  }
                : {
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
                  }),
              aspectRatio: '402 / 834',
              zIndex: 5,
              cursor: showProfiles ? 'pointer' : 'default',
              userSelect: 'none',
              transition: 'left 0.4s cubic-bezier(0.22, 1, 0.36, 1), top 0.4s cubic-bezier(0.22, 1, 0.36, 1), bottom 0.4s cubic-bezier(0.22, 1, 0.36, 1), height 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
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
                    borderRadius: 50,
                    pointerEvents: 'none',
                    transformOrigin: '50% 88%',
                    filter: slot === 0
                      ? 'drop-shadow(0 24px 32px rgba(0,0,0,0.14)) drop-shadow(0 0 1px rgba(0,0,0,0.06))'
                      : 'drop-shadow(0 18px 26px rgba(0,0,0,0.10))',
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
                    boxShadow: '0 0 0 2px #fff, 0 6px 14px rgba(0,0,0,0.12)',
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
                        ? 'drop-shadow(0 18px 28px rgba(0,0,0,0.18)) drop-shadow(0 4px 6px rgba(0,0,0,0.10))'
                        : 'drop-shadow(0 8px 14px rgba(0,0,0,0.10))',
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
                    boxShadow: '0 0 0 2px #fff, 0 6px 14px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06)',
                    zIndex: 2,
                  }} />
                  <div style={{
                    padding: '14px 20px 14px 36px',
                    borderRadius: 22,
                    background: '#fff',
                    color: '#1e1e1e',
                    fontSize: 15,
                    lineHeight: 1.32,
                    boxShadow: '0 10px 28px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04)',
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
                  boxShadow: '0 14px 36px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.06)',
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
                      boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
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
                    filter: 'drop-shadow(0 10px 14px rgba(0,0,0,0.18))',
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
            background: renderStyle === 'shaders' ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.8)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: renderStyle === 'shaders'
              ? '1.5px solid rgba(255,255,255,0.85)'
              : '1.5px solid rgba(0,0,0,0.05)',
            boxShadow:
              '0 18px 17px rgba(0,0,0,0.05), inset -1.8px -1.8px 1.8px rgba(0,0,0,0.05), inset 1.8px 1.8px 1.8px rgba(0,0,0,0.03), inset 0 0 12px rgba(0,0,0,0.03)',
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

      {/* Collapsed panel — small glass settings pill in the BOTTOM-RIGHT.
          Click to expand into the full panel. Default true on mobile, false on
          desktop; toggleable from the panel's collapse button.
          Also DRAGGABLE — pointer-capture pattern, click vs drag disambiguated
          by total movement distance (<4px counts as click). */}
      {showControls && !showcaseMode && panelCollapsed && (
        <DraggableSettingsPill onClick={() => setPanelCollapsed(false)} />
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
          color: 'rgba(30,30,30,0.42)',
        };
        const SECTION_GAP = 10;
        // Apple Liquid Glass segmented control — glassy track, glassy
        // dark "selected" pill with a subtle inner highlight + soft drop
        // shadow so the active option visually lifts off the track.
        const segGroup: React.CSSProperties = {
          display: 'flex',
          background: 'rgba(255,255,255,0.45)',
          borderRadius: 10,
          padding: 3,
          gap: 0,
          border: '1px solid rgba(255,255,255,0.55)',
          boxShadow:
            'inset 0 1px 2px rgba(0,0,0,0.05), 0 0.5px 0 rgba(255,255,255,0.6) inset',
          backdropFilter: 'blur(10px) saturate(160%)',
          WebkitBackdropFilter: 'blur(10px) saturate(160%)',
        };
        const segBtn = (active: boolean): React.CSSProperties => ({
          flex: 1,
          padding: '5px 6px',
          border: active ? '1px solid rgba(0,0,0,0.65)' : '1px solid transparent',
          borderRadius: 7,
          background: active ? '#1e1e1e' : 'transparent',
          color: active ? '#fff' : 'rgba(30,30,30,0.6)',
          fontSize: 11,
          fontWeight: active ? 600 : 500,
          textTransform: 'capitalize',
          cursor: 'pointer',
          transition:
            'background 0.22s cubic-bezier(0.5, 0, 0.2, 1), color 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease',
          fontFamily: 'inherit',
          boxShadow: active
            ? '0 1px 2px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(0,0,0,0.4)'
            : 'none',
        });
        const pillBtn = (active: boolean): React.CSSProperties => ({
          flex: 1,
          padding: '6px 10px',
          border: '1px solid rgba(0,0,0,0.05)',
          borderRadius: 999,
          background: active ? '#1e1e1e' : 'rgba(255,255,255,0.45)',
          color: active ? '#fff' : 'rgba(30,30,30,0.78)',
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
              border: '1px solid rgba(0,0,0,0.06)',
              background: on ? '#1e1e1e' : 'rgba(255,255,255,0.55)',
              boxShadow: on
                ? 'inset 0 1px 2px rgba(0,0,0,0.35), 0 0.5px 0 rgba(255,255,255,0.55) inset'
                : 'inset 0 1px 2px rgba(0,0,0,0.05), 0 0.5px 0 rgba(255,255,255,0.7) inset',
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
              boxShadow: '0 1px 2.5px rgba(0,0,0,0.28), 0 0.5px 0 rgba(0,0,0,0.08)',
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
              color: 'rgba(30,30,30,0.55)',
            }}>
              {label}
              {hint != null && (
                <span style={{
                  textTransform: 'none',
                  letterSpacing: 0,
                  fontWeight: 500,
                  fontSize: 10,
                  color: hintColor ?? 'rgba(30,30,30,0.5)',
                }}>{hint}</span>
              )}
            </span>
            <Switch on={on} onChange={onChange} ariaLabel={label} />
          </div>
        );
        // Drag handlers for the panel — only the grip strip at the top
        // initiates a drag, so the controls underneath stay clickable.
        const onPanelDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          panelDragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            base: panelOffset,
          };
          setPanelDragging(true);
        };
        const onPanelDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
          const d = panelDragRef.current;
          if (!d) return;
          setPanelOffset({
            x: d.base.x + (e.clientX - d.startX),
            y: d.base.y + (e.clientY - d.startY),
          });
        };
        const onPanelDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
          if (!panelDragRef.current) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          panelDragRef.current = null;
          setPanelDragging(false);
        };

        return (
          <div className="blur-in" style={{
            position: 'absolute',
            top: 84,
            left: 16,
            width: 224,
            // Reserve a touch more top padding for the grip strip; the strip
            // sits inside it so the inner controls don't shift.
            padding: '20px 14px 14px',
            borderRadius: 18,
            background: 'rgba(255,255,255,0.36)',
            backdropFilter: 'blur(36px) saturate(190%)',
            WebkitBackdropFilter: 'blur(36px) saturate(190%)',
            border: '1px solid rgba(255,255,255,0.55)',
            boxShadow:
              '0 1px 0 rgba(255,255,255,0.55) inset, 0 -1px 0 rgba(0,0,0,0.03) inset, 0 20px 44px rgba(0,0,0,0.10), 0 4px 12px rgba(0,0,0,0.05)',
            color: '#1e1e1e',
            fontFamily: '"Selecta", system-ui, -apple-system, sans-serif',
            fontSize: 12,
            zIndex: 90,
            animationDelay: '500ms',
            // Drag offset applied via transform so layout stays stable.
            transform: `translate(${panelOffset.x}px, ${panelOffset.y}px)`,
            transition: panelDragging
              ? 'none'
              : 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)',
          }}>
            {/* Drag handle — slim grip strip across the top of the panel.
                Pointer-capture starts a drag; the controls below are
                unaffected because the handle only covers the very top. */}
            <div
              onPointerDown={onPanelDragStart}
              onPointerMove={onPanelDragMove}
              onPointerUp={onPanelDragEnd}
              onPointerCancel={onPanelDragEnd}
              role="separator"
              aria-label="Drag controls panel"
              title="Drag to move"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: panelDragging ? 'grabbing' : 'grab',
                touchAction: 'none',
                userSelect: 'none',
                borderTopLeftRadius: 18,
                borderTopRightRadius: 18,
              }}
            >
              {/* Visible grip — small rounded bar centered in the strip,
                  same charcoal as the panel text but very dim. */}
              <span style={{
                width: 32,
                height: 4,
                borderRadius: 999,
                background: 'rgba(30,30,30,0.22)',
                pointerEvents: 'none',
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
                background: 'rgba(0,0,0,0.05)',
                color: 'rgba(30,30,30,0.7)',
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
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.10)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
              </svg>
            </button>

            {/* Layout */}
            <div style={sectionLabel}>Layout</div>
            <div style={{ ...segGroup, marginBottom: SECTION_GAP }}>
              {(['left', 'center', 'right'] as const).map(l => (
                <button key={l} onClick={() => setLayout(l)} style={segBtn(layout === l)}>{l}</button>
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
            <SwitchRow label="Profiles"  on={showProfiles}      onChange={setShowProfiles} />
            <SwitchRow label="Floats"    on={showNotifications} onChange={setShowNotifications} />
            <SwitchRow label="3D icons"  on={showPersonaProps}  onChange={setShowPersonaProps} />
            <SwitchRow
              label="Make it personal"
              on={personalMode}
              onChange={setPersonalMode}
            />
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

            {/* Joystick sound — pick one of three synths; tap to preview */}
            <div style={sectionLabel}>Joystick sound</div>
            <div style={{ ...segGroup, marginBottom: SECTION_GAP }}>
              {([
                ['lever',  'Lever',  playLeverSound],
                ['bubble', 'Bubble', playBubbleSound],
                ['whoosh', 'Whoosh', playWhooshSound],
              ] as const).map(([key, label, preview]) => (
                <button
                  key={key}
                  onClick={() => {
                    setJoystickSound(key);
                    preview(false); // play the "engage" variant as a preview
                  }}
                  style={segBtn(joystickSound === key)}
                >{label}</button>
              ))}
            </div>

            {/* (Generate-orb UI removed from the panel — the /api/generate-orb
                endpoint + generateOrb handler are still wired up, just no
                input/button surfaced anymore.) */}

            {/* Damping */}
            <div style={sectionLabel}>
              <span style={{ display: 'inline-flex', justifyContent: 'space-between', width: '100%' }}>
                <span>Damping</span>
                <span style={{ opacity: 0.7 }}>{damping.toFixed(3)}</span>
              </span>
            </div>
            <input
              type="range" min="0.001" max="0.05" step="0.001"
              value={damping} onChange={(e) => setDamping(parseFloat(e.target.value))}
              style={{ width: '100%', cursor: 'pointer', marginBottom: 8, accentColor: '#1e1e1e' }}
            />

            {/* Orb size */}
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
              background: 'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0.08) 20%, rgba(0,0,0,0.08) 80%, rgba(0,0,0,0) 100%)',
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
                  // camera + core gestures + Focus.
                  setHandMode(true);
                  setHandControl(true);
                  setFocusMode(true);
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
              border: '1px solid rgba(255,255,255,0.55)',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.42)',
              backdropFilter: 'blur(28px) saturate(180%)',
              WebkitBackdropFilter: 'blur(28px) saturate(180%)',
              boxShadow: '0 18px 40px rgba(0,0,0,0.12), 0 4px 10px rgba(0,0,0,0.06)',
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
            background: 'rgba(255,255,255,0.35)',
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
              background: 'rgba(255,255,255,0.78)',
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)',
              boxShadow:
                '0 14px 70px rgba(0,0,0,0.20), inset 1px 1px 1px rgba(255,255,255,0.32), inset -1px -1px 1px rgba(0,0,0,0.06)',
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
                background: 'rgba(0,0,0,0.04)',
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
                e.currentTarget.style.background = 'rgba(0,0,0,0.08)';
                e.currentTarget.style.transform = 'scale(1.06)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
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
                  border: '2px solid rgba(0,0,0,0.08)',
                  boxShadow:
                    '0 8px 16px rgba(0,0,0,0.10), 0 4px 12px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02)',
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
                  background: 'rgba(255,255,255,0.55)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  boxShadow: '0 5px 25px rgba(0,0,0,0.06), inset 0 0 0 0.5px rgba(255,255,255,0.6)',
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
                    'inset -1px -1px 2px rgba(255,255,255,0.32), inset 1px 1px 1px rgba(255,255,255,0.12), 0 4px 12px rgba(0,0,0,0.15)',
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

      {/* Joystick — toggles between physics (drop) and cyclone (formation) */}
      {!showcaseMode && (
        <Joystick
          sound={joystickSound}
          // Lever visual progression: state 0 neutral, 1 mid-pull, 2 fully pulled.
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
            background: 'rgba(20,20,20,0.86)',
            color: '#fff',
            fontFamily: '"Selecta", system-ui, -apple-system, sans-serif',
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: 0.3,
            backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 18px 36px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.12)',
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
            boxShadow: '0 0 12px rgba(124,255,170,0.65)',
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
      {!minimalUI && <Footer />}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * DraggableSettingsPill — collapsed-controls launcher.
 *   - Anchored to the bottom-right corner by default so it never collides with
 *     the wabi logo (top-left) or the joystick (bottom-left).
 *   - Click to expand; drag to reposition. Click vs drag is disambiguated by
 *     total pointer movement: under 4px counts as a click and fires onClick.
 *   - Pointer capture keeps the drag alive even if the cursor leaves the pill.
 * ------------------------------------------------------------------------- */
function DraggableSettingsPill({ onClick }: { onClick: () => void }) {
  // Offset stored as delta from the bottom-right anchor (so it survives a
  // window resize by staying near that corner).
  const [offset, setOffset] = useState({ x: 0, y: 0 });
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
      base: offset,
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
    setOffset({ x: d.base.x + dx, y: d.base.y + dy });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const wasClick = d.moved < 4;
    dragRef.current = null;
    setDragging(false);
    if (wasClick) onClick();
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
        position: 'fixed',
        right: 16,
        bottom: 16,
        width: 44,
        height: 44,
        border: '1px solid rgba(255,255,255,0.55)',
        borderRadius: 14,
        background: 'rgba(255,255,255,0.42)',
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        boxShadow: '0 10px 24px rgba(0,0,0,0.10), 0 4px 8px rgba(0,0,0,0.06)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: dragging ? 'grabbing' : 'grab',
        zIndex: 95,
        padding: 0,
        // x grows right (so negative pushes it left from the corner); y grows
        // down (so negative pushes it up from the corner). Translate handles it.
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        transition: dragging ? 'none' : 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
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
