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
  // Ref to the bento <section> so toggling it on can smooth-scroll into view.
  const bentoSectionRef = useRef<HTMLElement | null>(null);
  // Holds AI-generated orb URLs (data: URLs from /api/generate-orb).
  // These are prioritized by the picker so freshly-made orbs show up next.
  const aiCoversRef = useRef<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const mouseConstraintRef = useRef<Matter.MouseConstraint | null>(null);
  const overlayImageRef = useRef<HTMLImageElement | null>(null);

  const [, setOrbCount] = useState(0);
  const [, setLatestUser] = useState<string | null>(null);
  const [damping, setDamping] = useState(0.005);
  const [moonMode, setMoonMode] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [layout, setLayout] = useState<'left' | 'center' | 'right'>('center');
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
  const [showProfiles, setShowProfiles] = useState(true);
  const [showBento, setShowBento] = useState(false);
  // Which synthesized joystick sound to use ("lever" was the original).
  const [joystickSound, setJoystickSound] = useState<JoystickSound>('lever');
  // Hand-control mode — camera + MediaPipe HandLandmarker, two-hand clap
  // triggers the joystick toggle, gesture (open/fist) flips physics/cyclone,
  // hand position drives the cyclone parallax tilt.
  const [handControl, setHandControl] = useState(false);
  const [handExtras, setHandExtras] = useState(false);
  const [handStatus, setHandStatus] = useState<'off' | 'loading' | 'ready' | 'denied' | 'error'>('off');
  const [handCameraSize, setHandCameraSize] = useState<'s' | 'm' | 'l' | 'xl'>('m');
  const [handShowSkeleton, setHandShowSkeleton] = useState(true);
  // Cyclone radius multiplier (1.0 = default). Pinned to 1 unless an open
  // palm is held, in which case palm height drives it (high → tight, low → wide).
  const cycloneRadiusMulRef = useRef(1.0);
  const cycloneRadiusMulTargetRef = useRef(1.0);
  // Tractor-beam point in viewport-pixel coords (decays automatically).
  // (x, y, expiresAt) — orbs pull toward this point while it's active.
  const tractorBeamRef = useRef<{ x: number; y: number; expiresAt: number } | null>(null);
  const [currentShape, setCurrentShape] = useState(0);
  const [showcaseMode, setShowcaseMode] = useState(false);
  // Focus mode = orbs-only-but-keep-controls. Hides the headline, phone,
  // persona props, header, footer, etc. — but the controls panel and the
  // hand-control webcam stay visible. Cyclone re-centers to viewport middle.
  const [focusMode, setFocusMode] = useState(false);
  const [showcaseOrbCount] = useState(60);
  const [orbSize, setOrbSize] = useState(1.0);

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

  // Ref to the prompt input + handler that hits /api/generate-orb. The endpoint
  // returns a data URL we push onto aiCoversRef so the next addOrb() picks it.
  const genPromptRef = useRef<HTMLInputElement>(null);
  const generateOrb = useCallback(async () => {
    if (isGenerating) return;
    setGenError(null);
    setIsGenerating(true);
    try {
      const prompt = (genPromptRef.current?.value || '').trim();
      const response = await fetch('/api/generate-orb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prompt ? { prompt } : {}),
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error || `HTTP ${response.status}`);
      }
      const images: string[] = json.images || [];
      if (images.length === 0) throw new Error('No image returned');

      // Pre-decode the image so the orb renders immediately on add.
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          preloadedImagesRef.current.set(images[0], img);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = images[0];
      });

      // Queue the URL for the next addOrb call, then spawn.
      aiCoversRef.current.push(images[0]);
      addOrb();
    } catch (err: any) {
      setGenError(err?.message || 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  }, [addOrb, isGenerating]);

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
    if (engineRef.current) engineRef.current.gravity.y = 1;
    setMoonMode(false);
    setDisplayMode(mode);
  }, []);

  // Shared "lever toggle" — flips physics ↔ cyclone exactly like the joystick.
  // Lives at the top level so the joystick AND the hand-clap can both call it.
  const displayModeForToggleRef = useRef(displayMode);
  useEffect(() => { displayModeForToggleRef.current = displayMode; }, [displayMode]);
  const addOrbRefForToggle = useRef<((x?: number) => void) | null>(null);
  const toggleLever = useCallback(() => {
    const goingToPhysics = displayModeForToggleRef.current !== 'physics';
    setMode(goingToPhysics ? 'physics' : 'cyclone');
    if (goingToPhysics && addOrbRefForToggle.current) {
      const newOrbCount = 5 + Math.floor(Math.random() * 3); // 5-7
      for (let i = 0; i < newOrbCount; i++) {
        const delay = i * 90 + Math.random() * 80;
        const x = window.innerWidth * (0.12 + Math.random() * 0.76);
        setTimeout(() => addOrbRefForToggle.current?.(x), delay);
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
        if (!ctx || !engineRef.current) return;

        const mode = displayModeRef.current;
        const style = renderStyleRef.current;
        // Orb play area is constrained to the left half — motion modes center on that
        // Orbital motion centers on the phone for the current layout — except
        // in focus/showcase modes, where there's no phone and we re-center the
        // cyclone to the actual viewport middle.
        const _layout = layoutRef.current;
        const _orbsOnly = focusModeRef.current || showcaseModeRef.current;
        const _phoneXFrac = _orbsOnly
          ? 0.5
          : _layout === 'left' ? 0.28 : _layout === 'right' ? 0.72 : 0.5;
        const _phoneXOffset = _orbsOnly
          ? 0
          : _layout === 'left' ? 60 : _layout === 'right' ? -60 : 0;
        const centerX = window.innerWidth * _phoneXFrac + _phoneXOffset;
        const _phoneHcalc = _layout === 'center'
          ? Math.max(390, Math.min(700, window.innerHeight * 0.63))
          : Math.max(420, Math.min(720, window.innerHeight * 0.72));
        const centerY = _orbsOnly
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

        // Smooth mouse-tilt toward its target (low-pass filter)
        {
          const t = mouseTiltTargetRef.current;
          const c = mouseTiltRef.current;
          c.x += (t.x - c.x) * 0.06;
          c.y += (t.y - c.y) * 0.06;
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

            // Ellipse sized to wrap the centered phone, capped to viewport
            const phoneH = Math.max(390, Math.min(700, window.innerHeight * 0.63));
            const phoneW = phoneH * (402 / 834);
            const minR = Math.max(phoneW / 2, phoneH / 2.6) + 90;
            const maxR = Math.min(window.innerWidth, window.innerHeight) * 0.5;
            const baseR = Math.min(minR, maxR);
            // Smooth radius multiplier (driven by hand height when extras on).
            cycloneRadiusMulRef.current +=
              (cycloneRadiusMulTargetRef.current - cycloneRadiusMulRef.current) * 0.06;
            const radMul = cycloneRadiusMulRef.current;
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
            const TILT = 1.25 + mtY * 0.18;     // mouse-Y nudges tilt
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
            // Physics mode
            Matter.Body.setStatic(body, false);
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

        animationId = requestAnimationFrame(render);
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
        if (e.key === 'm' || e.key === 'M') {
          const newMode = !moonModeRef.current;
          engine.gravity.y = newMode ? -0.4 : 1;
          setMoonMode(newMode);
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
        if (e.key === 's' || e.key === 'S') {
          setDisplayMode(prev => {
            if (prev === 'shapes') {
              // Cycle to next shape
              setCurrentShape(curr => (curr + 1) % SHAPES.length);
              return 'shapes';
            }
            return 'shapes';
          });
          setMoonMode(false);
        }
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
        @keyframes scroll-hint-bounce {
          0%, 100% { transform: translate(-50%, 0); }
          50%      { transform: translate(-50%, 6px); }
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

      {/* Headline + subhead (positioned per layout) */}
      {!minimalUI && (
        <div style={{
          position: 'absolute',
          ...(layout === 'center'
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
            fontSize: layout === 'center'
              ? 'clamp(24px, 3.5vw, 50px)'
              : 'clamp(22px, 2.8vw, 40px)',
            lineHeight: 1.11,
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
            fontSize: 'clamp(13px, 1.3vw, 22px)',
            lineHeight: 1.25,
            letterSpacing: '-0.01em',
            // Animated start state has opacity:0; the .blur-in `both` fill
            // keeps the end opacity at 1, so use color alpha (not opacity)
            // to keep the dim look without fighting the keyframes.
            color: renderStyle === 'shaders' ? 'rgba(255,255,255,0.75)' : 'rgba(99,99,99,0.95)',
            margin: 0,
            maxWidth: 400,
            marginLeft: 'auto',
            marginRight: 'auto',
            fontWeight: 400,
            fontFeatureSettings: '"dlig" 1',
            animationDelay: '300ms',
          }}>
            Describe what you want. Customize the vibe. Share instantly.
          </p>

          {/* QR inside the text column on side layouts */}
          {layout !== 'center' && (
            <div
              className="orb-qr-card"
              style={{
                width: 'clamp(96px, 9vw, 132px)',
                aspectRatio: '1 / 1',
                padding: 'clamp(6px, 0.6vw, 9px)',
                borderRadius: 'clamp(14px, 1.6vw, 22px)',
                margin: 'clamp(20px, 2.5vh, 36px) auto 0',
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
                transformOrigin: 'top center',
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
              left: layout === 'left'
                ? 'calc(28% + 60px)'
                : layout === 'right'
                ? 'calc(72% - 60px)'
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
      {!minimalUI && (() => {
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
            ? 'calc(28% + 60px)'
            : layout === 'right'
            ? 'calc(72% - 60px)'
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

      {/* Floating QR — only in center layout; side layouts render it inside the text column */}
      {!minimalUI && layout === 'center' && (
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

      {/* Combined glassy control panel */}
      {showControls && !showcaseMode && (() => {
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
        const segGroup: React.CSSProperties = {
          display: 'flex',
          background: 'rgba(0,0,0,0.04)',
          borderRadius: 8,
          padding: 2,
          gap: 2,
        };
        const segBtn = (active: boolean): React.CSSProperties => ({
          flex: 1,
          padding: '5px 6px',
          border: 0,
          borderRadius: 6,
          background: active ? '#1e1e1e' : 'transparent',
          color: active ? '#fff' : 'rgba(30,30,30,0.6)',
          fontSize: 11,
          fontWeight: active ? 600 : 500,
          textTransform: 'capitalize',
          cursor: 'pointer',
          transition: 'background 0.2s ease, color 0.2s ease',
          fontFamily: 'inherit',
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
        return (
          <div className="blur-in" style={{
            position: 'absolute',
            top: 84,
            left: 16,
            width: 224,
            padding: 14,
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
          }}>
            {/* Layout */}
            <div style={sectionLabel}>Layout</div>
            <div style={{ ...segGroup, marginBottom: SECTION_GAP }}>
              {(['left', 'center', 'right'] as const).map(l => (
                <button key={l} onClick={() => setLayout(l)} style={segBtn(layout === l)}>{l}</button>
              ))}
            </div>

            {/* Motion */}
            <div style={sectionLabel}>Motion</div>
            <div style={{ ...segGroup, marginBottom: SECTION_GAP, flexWrap: 'wrap' }}>
              {(['physics', 'cyclone', 'orbit', 'shapes'] as const).map(m => (
                <button key={m} onClick={() => setMode(m)} style={segBtn(displayMode === m)}>{m}</button>
              ))}
            </div>

            {displayMode === 'shapes' && (
              <>
                <div style={sectionLabel}>Shape</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: SECTION_GAP }}>
                  <button onClick={() => setCurrentShape((c) => (c - 1 + SHAPES.length) % SHAPES.length)}
                    style={{ ...pillBtn(false), flex: 0, padding: '5px 10px' }}>‹</button>
                  <div style={{
                    flex: 1, textAlign: 'center', padding: '5px 10px',
                    background: 'rgba(0,0,0,0.04)', borderRadius: 999,
                    color: '#1e1e1e', fontWeight: 600, textTransform: 'capitalize', fontSize: 11,
                  }}>{SHAPES[currentShape]}</div>
                  <button onClick={() => setCurrentShape((c) => (c + 1) % SHAPES.length)}
                    style={{ ...pillBtn(false), flex: 0, padding: '5px 10px' }}>›</button>
                </div>
              </>
            )}

            {/* Profiles — single phone vs swipeable 3-screen carousel */}
            <div style={sectionLabel}>Profiles</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: SECTION_GAP }}>
              <button
                onClick={() => setShowProfiles(false)}
                style={pillBtn(!showProfiles)}
              >Off</button>
              <button
                onClick={() => setShowProfiles(true)}
                style={pillBtn(showProfiles)}
              >On</button>
            </div>

            {/* Floats — toggle the cycling chat/like notifications */}
            <div style={sectionLabel}>Floats</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: SECTION_GAP }}>
              <button
                onClick={() => setShowNotifications(false)}
                style={pillBtn(!showNotifications)}
              >Off</button>
              <button
                onClick={() => setShowNotifications(true)}
                style={pillBtn(showNotifications)}
              >On</button>
            </div>

            {/* Bento — toggle the scroll-down bento section below the hero */}
            <div style={sectionLabel}>Bento</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: SECTION_GAP }}>
              <button
                onClick={() => {
                  setShowBento(false);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                style={pillBtn(!showBento)}
              >Off</button>
              <button
                onClick={() => {
                  setShowBento(true);
                  // Wait a frame for the section to mount, then smooth-scroll
                  // to it so the user immediately sees what they enabled.
                  requestAnimationFrame(() => {
                    setTimeout(() => {
                      bentoSectionRef.current?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                      });
                    }, 60);
                  });
                }}
                style={pillBtn(showBento)}
              >On</button>
            </div>

            {/* Hand control — camera + MediaPipe HandLandmarker. Move your
                hand, open palm restores the cyclone, fist drops to physics,
                CLAP triggers the same lever as the joystick. */}
            <div style={sectionLabel}>
              <span style={{ display: 'inline-flex', justifyContent: 'space-between', width: '100%' }}>
                <span>Hand control</span>
                {handStatus !== 'off' && handStatus !== 'ready' && (
                  <span style={{
                    opacity: 0.7,
                    textTransform: 'none',
                    letterSpacing: 0,
                    fontWeight: 500,
                    color: handStatus === 'denied' || handStatus === 'error' ? '#b91c1c' : 'rgba(30,30,30,0.55)',
                  }}>
                    {handStatus === 'loading' && 'Loading…'}
                    {handStatus === 'denied'  && 'Denied'}
                    {handStatus === 'error'   && 'Error'}
                  </span>
                )}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: handControl ? 8 : SECTION_GAP }}>
              <button onClick={() => setHandControl(false)} style={pillBtn(!handControl)}>Off</button>
              <button onClick={() => setHandControl(true)}  style={pillBtn(handControl)}>On</button>
            </div>
            {/* Extra gestures sub-toggle — only meaningful when Hand control on */}
            {handControl && (
              <>
                <div style={{ ...sectionLabel, marginTop: 2 }}>
                  <span style={{ display: 'inline-flex', justifyContent: 'space-between', width: '100%' }}>
                    <span>Extra gestures</span>
                    <span style={{ opacity: 0.55, textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                      pinch · point · spread · height
                    </span>
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <button onClick={() => setHandExtras(false)} style={pillBtn(!handExtras)}>Off</button>
                  <button onClick={() => setHandExtras(true)}  style={pillBtn(handExtras)}>On</button>
                </div>

                {/* Camera size — S / M / L / XL segmented control */}
                <div style={sectionLabel}>Camera size</div>
                <div style={{ ...segGroup, marginBottom: 8 }}>
                  {(['s', 'm', 'l', 'xl'] as const).map(s => (
                    <button key={s} onClick={() => setHandCameraSize(s)} style={segBtn(handCameraSize === s)}>
                      {s.toUpperCase()}
                    </button>
                  ))}
                </div>

                {/* Tracking — show live hand skeleton on the feed */}
                <div style={sectionLabel}>Tracking</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: SECTION_GAP }}>
                  <button onClick={() => setHandShowSkeleton(false)} style={pillBtn(!handShowSkeleton)}>Off</button>
                  <button onClick={() => setHandShowSkeleton(true)}  style={pillBtn(handShowSkeleton)}>On</button>
                </div>
              </>
            )}

            {/* Focus — orbs in the middle, everything else hidden, BUT keep
                this control panel and the hand-control webcam. Different from
                Playground (below) which hides the panel too. */}
            <div style={sectionLabel}>Focus</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: SECTION_GAP }}>
              <button onClick={() => setFocusMode(false)} style={pillBtn(!focusMode)}>Off</button>
              <button onClick={() => setFocusMode(true)}  style={pillBtn(focusMode)}>On</button>
            </div>

            {/* Playground — fullscreen orbs-only vibe (hides this panel too). */}
            <div style={sectionLabel}>Playground</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: SECTION_GAP }}>
              <button
                onClick={() => {
                  setShowcaseMode(true);
                  dropAllOrbsRef.current(60);
                }}
                style={{ ...pillBtn(true), width: '100%' }}
              >Launch</button>
            </div>

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

            {/* Generate — call OpenAI image API to spawn brand-new orb covers */}
            <div style={sectionLabel}>Generate orb</div>
            <input
              ref={genPromptRef}
              type="text"
              placeholder="Prompt (optional)"
              style={{
                width: '100%',
                padding: '6px 10px',
                marginBottom: 5,
                border: '1px solid rgba(0,0,0,0.06)',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.55)',
                fontSize: 11,
                fontFamily: 'inherit',
                color: '#1e1e1e',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') generateOrb();
              }}
            />
            <button
              onClick={generateOrb}
              disabled={isGenerating}
              style={{
                ...pillBtn(true),
                width: '100%',
                opacity: isGenerating ? 0.7 : 1,
                cursor: isGenerating ? 'progress' : 'pointer',
                marginBottom: genError ? 4 : SECTION_GAP,
              }}
            >
              {isGenerating ? 'Generating…' : 'Generate'}
            </button>
            {genError && (
              <div style={{
                marginBottom: SECTION_GAP,
                fontSize: 10,
                color: '#b91c1c',
                lineHeight: 1.4,
              }}>{genError}</div>
            )}

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
          </div>
        );
      })()}

      {/* Instructions */}
      {!minimalUI && (
        <div style={{
          position: 'absolute', top: 96, left: '50%', transform: 'translateX(-50%)',
          color: renderStyle === 'shaders' ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)',
          fontFamily: 'system-ui, sans-serif', fontSize: 12,
          pointerEvents: 'none', userSelect: 'none',
          textAlign: 'center',
        }}>
          Click to drop · Tap orb to view · Press D for controls
        </div>
      )}

      {/* Scroll-down chevron — visible only when bento is enabled so users
          know there's more content below the hero. Sits just above the footer
          and gently bobs. */}
      {!minimalUI && showBento && (
        <button
          type="button"
          onClick={() => bentoSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          aria-label="Scroll to bento"
          style={{
            position: 'absolute',
            bottom: 96,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 40, height: 40,
            border: 0,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.8)',
            boxShadow: '0 6px 18px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.04)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 60,
            animation: 'scroll-hint-bounce 1.8s ease-in-out infinite',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 5l4 4 4-4" stroke="#1e1e1e" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

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

          {handControl && handExtras && (
            <div
              aria-hidden="true"
              style={{
                position: 'fixed',
                bottom: 24,
                left: 24,
                padding: '12px 14px',
                borderRadius: 14,
                background: 'rgba(255,255,255,0.32)',
                backdropFilter: 'blur(24px) saturate(180%)',
                WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                border: '1px solid rgba(255,255,255,0.55)',
                boxShadow: '0 10px 24px rgba(0,0,0,0.10)',
                color: '#1e1e1e',
                fontFamily: '"Selecta", system-ui, -apple-system, sans-serif',
                fontSize: 11,
                lineHeight: 1.55,
                zIndex: 105,
                pointerEvents: 'none',
                maxWidth: 220,
              }}
            >
              <div style={{ fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', fontSize: 9, marginBottom: 6, opacity: 0.55 }}>
                Hand gestures
              </div>
              <div>✋ Open → cyclone</div>
              <div>✊ Fist → drop</div>
              <div>👆 Point → tractor beam</div>
              <div>🤏 Pinch → spawn orb</div>
              <div>👐 Spread → explode</div>
              <div>🙌 Squeeze → cluster</div>
              <div>👋 Clap → toggle lever</div>
              <div>📏 Palm height → cyclone size</div>
            </div>
          )}
        </>
      )}

      {/* Bento — 4 cards in a wide/square grid below the hero */}
      {!minimalUI && showBento && (
        <section ref={bentoSectionRef} style={{
          width: '100%',
          padding: 'clamp(48px, 6vw, 96px) clamp(20px, 4vw, 64px) clamp(120px, 12vw, 180px)',
          background: '#f0f0f0',
          fontFamily: '"Selecta", system-ui, -apple-system, sans-serif',
          position: 'relative',
          zIndex: 0,
        }}>
          <div style={{
            maxWidth: 1500,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gridAutoRows: 'minmax(380px, 460px)',
            gap: 24,
          }}>
            {/* 1 — Creation that feels like play (wide-left) */}
            <article style={{
              gridColumn: '1 / 3',
              background: '#fff',
              borderRadius: 24,
              padding: 'clamp(28px, 3vw, 52px)',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 40px 50px rgba(0,0,0,0.05), 0 1px 0 rgba(0,0,0,0.02)',
              display: 'flex',
              alignItems: 'center',
            }}>
              <h2 style={{
                margin: 0,
                fontSize: 'clamp(24px, 2.4vw, 34px)',
                lineHeight: 1.1,
                fontWeight: 400,
                color: '#0a0a0a',
                maxWidth: 280,
                position: 'relative',
                zIndex: 2,
              }}>Creation that feels like play</h2>
              {/* Decorative orb cluster on the right */}
              <div style={{
                position: 'absolute',
                right: '-3%',
                top: '50%',
                transform: 'translateY(-50%)',
                width: 'clamp(260px, 35%, 480px)',
                aspectRatio: '1',
                background:
                  'radial-gradient(circle at 30% 30%, #ffd29a 0%, #f0a868 35%, #b3563a 75%, transparent 80%), radial-gradient(circle at 70% 70%, rgba(180, 130, 255, 0.5) 0%, transparent 40%)',
                borderRadius: '50%',
                filter: 'blur(4px)',
                opacity: 0.85,
              }} />
            </article>

            {/* 2 — Remix anything you see (square-right) */}
            <article style={{
              gridColumn: '3 / 4',
              background: '#fff',
              borderRadius: 24,
              padding: 'clamp(28px, 3vw, 52px)',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 40px 50px rgba(0,0,0,0.05), 0 1px 0 rgba(0,0,0,0.02)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}>
              {/* Mini "app card" preview at the top, peeking up */}
              <div style={{
                position: 'absolute',
                top: -36,
                left: '50%',
                transform: 'translateX(-50%)',
                width: '76%',
                aspectRatio: '1 / 1.05',
                borderRadius: 28,
                background: 'rgba(255,255,255,0.78)',
                backdropFilter: 'blur(20px) saturate(180%)',
                WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                boxShadow:
                  '0 14px 70px rgba(0,0,0,0.20), inset 1px 1px 1px rgba(255,255,255,0.32), inset -1px -1px 1px rgba(0,0,0,0.06)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: 'clamp(20px, 2.5vw, 36px) 12px',
                gap: 12,
              }}>
                <div style={{
                  width: 76,
                  height: 76,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle at 30% 30%, #ffbe8a, #c2543f)',
                  boxShadow: '0 8px 16px rgba(0,0,0,0.10), 0 0 0 2px rgba(0,0,0,0.06)',
                }} />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 500, fontSize: 18, color: '#1e1e1e', marginBottom: 4 }}>London story creator</div>
                  <div style={{ fontSize: 13, color: '#525252', maxWidth: 200, margin: '0 auto', lineHeight: 1.35 }}>
                    Play a fast-paced card game with vibrant 80s anime vibes.
                  </div>
                </div>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 16px',
                  borderRadius: 999,
                  background: 'linear-gradient(to top, #0a0a0a, #4a4a4a)',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 500,
                  boxShadow: 'inset -1px -1px 2px rgba(255,255,255,0.3), inset 1px 1px 1px rgba(255,255,255,0.12)',
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Edit
                </div>
              </div>
              <h2 style={{
                marginTop: 'auto',
                marginBottom: 8,
                fontSize: 'clamp(24px, 2.4vw, 34px)',
                lineHeight: 1.1,
                fontWeight: 400,
                color: '#0a0a0a',
                textAlign: 'center',
              }}>Remix anything you see</h2>
            </article>

            {/* 3 — Discover the best from the community (square-left) */}
            <article style={{
              gridColumn: '1 / 2',
              background: '#fff',
              borderRadius: 24,
              padding: 'clamp(28px, 3vw, 52px)',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 40px 50px rgba(0,0,0,0.05), 0 1px 0 rgba(0,0,0,0.02)',
            }}>
              <h2 style={{
                margin: 0,
                fontSize: 'clamp(24px, 2.4vw, 34px)',
                lineHeight: 1.1,
                fontWeight: 400,
                color: '#0a0a0a',
                maxWidth: 320,
                position: 'relative',
                zIndex: 2,
              }}>Discover the best from the community</h2>
              {/* Phone screenshot background, fading down */}
              <img
                src="/dash-1.png"
                alt=""
                style={{
                  position: 'absolute',
                  left: '50%',
                  bottom: '-30%',
                  transform: 'translateX(-50%) scale(1.05)',
                  width: '85%',
                  height: 'auto',
                  borderRadius: 36,
                  filter: 'drop-shadow(0 24px 40px rgba(0,0,0,0.10))',
                  pointerEvents: 'none',
                }}
              />
            </article>

            {/* 4 — Apps built on your context (wide-right) */}
            <article style={{
              gridColumn: '2 / 4',
              background: '#fff',
              borderRadius: 24,
              padding: 'clamp(28px, 3vw, 52px)',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 40px 50px rgba(0,0,0,0.05), 0 1px 0 rgba(0,0,0,0.02)',
              display: 'flex',
              alignItems: 'center',
            }}>
              <h2 style={{
                margin: 0,
                fontSize: 'clamp(24px, 2.4vw, 34px)',
                lineHeight: 1.1,
                fontWeight: 400,
                color: '#0a0a0a',
                maxWidth: 280,
                position: 'relative',
                zIndex: 2,
              }}>Apps built on your context</h2>
              {/* Stacked integration cards on the right */}
              <div style={{
                position: 'absolute',
                right: 'clamp(28px, 4vw, 80px)',
                top: '50%',
                transform: 'translateY(-50%)',
                width: 'clamp(280px, 36%, 420px)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}>
                {[
                  { name: 'Spotify', color: 'linear-gradient(135deg, #1ed760, #1aa34a)', emoji: '♪' },
                  { name: 'Calendar', color: 'linear-gradient(135deg, #ff7a59, #d94a35)', emoji: '◷' },
                  { name: 'Messages', color: 'linear-gradient(135deg, #64b5ff, #1e88e5)', emoji: '✉' },
                ].map((svc) => (
                  <div key={svc.name} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '16px 18px',
                    borderRadius: 22,
                    background: 'rgba(242,242,242,0.7)',
                    backdropFilter: 'blur(20px) saturate(150%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(150%)',
                    boxShadow: '0 1px 0 rgba(0,0,0,0.02), 0 6px 18px rgba(0,0,0,0.06)',
                    border: '1px solid rgba(255,255,255,0.6)',
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: svc.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontSize: 20, fontWeight: 700,
                    }}>{svc.emoji}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 500, color: '#0a0a0a' }}>{svc.name}</div>
                      <div style={{ fontSize: 13, color: '#737373' }}>Connected</div>
                    </div>
                    {/* iOS-style green toggle */}
                    <div style={{
                      width: 44, height: 26, borderRadius: 999,
                      background: 'linear-gradient(180deg, #72d390, #6bc687)',
                      boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.18), inset 0 -1px 0 rgba(255,255,255,0.2)',
                      position: 'relative',
                    }}>
                      <div style={{
                        position: 'absolute',
                        right: 2, top: 2,
                        width: 22, height: 22,
                        borderRadius: '50%',
                        background: '#fff',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(0,0,0,0.06)',
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>
      )}

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
          pulled={displayMode === 'physics'}
          onToggle={toggleLever}
        />
      )}

      {/* Hand-control mode — camera + MediaPipe. Mounting toggles the camera.
          Works in playground (showcase) mode too — the gestures are the whole
          point there. */}
      <HandControl
        enabled={handControl}
        extras={handExtras}
        size={handCameraSize}
        showSkeleton={handShowSkeleton}
        onStatus={setHandStatus}
        onClap={() => {
          // Play the currently-selected joystick sound so it matches the lever.
          const sound = joystickSound === 'bubble' ? playBubbleSound
                      : joystickSound === 'whoosh' ? playWhooshSound
                      : playLeverSound;
          const goingToPhysics = displayModeForToggleRef.current !== 'physics';
          sound(!goingToPhysics);
          toggleLever();
        }}
        onHandPosition={(pos) => {
          if (!pos) return;
          // Mirror what the cursor parallax does: map normalized 0..1 → -1..1.
          mouseTiltTargetRef.current.x = Math.max(-1, Math.min(1, pos.x * 2 - 1));
          mouseTiltTargetRef.current.y = Math.max(-1, Math.min(1, pos.y * 2 - 1));
        }}
        onGesture={(g) => {
          // Open palm → cyclone (orbs reform). Closed fist → physics (drop).
          // 'point' is handled by onIndexPoint, ignored here.
          if (g === 'open' && displayModeForToggleRef.current !== 'cyclone') {
            setMode('cyclone');
          } else if (g === 'fist' && displayModeForToggleRef.current !== 'physics') {
            setMode('physics');
          }
        }}
        onPinch={(pos) => {
          // Spawn a fresh orb at the pinch point. Translate normalized → px.
          const x = pos.x * window.innerWidth;
          addOrb(x);
        }}
        onIndexPoint={(pos) => {
          if (pos) {
            tractorBeamRef.current = {
              x: pos.x * window.innerWidth,
              y: pos.y * window.innerHeight,
              // Refreshed every frame while pointing — short expiry so the beam
              // dies the moment the gesture is released.
              expiresAt: performance.now() + 200,
            };
          } else {
            tractorBeamRef.current = null;
          }
        }}
        onPalmHeight={(y) => {
          // y=0 (top) → wider cyclone (1.5x), y=1 (bottom) → tighter (0.6x).
          // Released (null) → snap target back to neutral 1.0.
          if (y == null) {
            cycloneRadiusMulTargetRef.current = 1.0;
          } else {
            const mul = 1.5 - y * 0.9; // y=0 → 1.5, y=1 → 0.6
            cycloneRadiusMulTargetRef.current = Math.max(0.55, Math.min(1.6, mul));
          }
        }}
        onSpread={(magnitude) => {
          // Push every orb radially outward from the screen center, once.
          if (!engineRef.current) return;
          const cx = window.innerWidth / 2;
          const cy = window.innerHeight / 2;
          const force = 0.012 * (0.4 + magnitude);
          Matter.Composite.allBodies(engineRef.current.world)
            .filter(b => b.label === 'orb')
            .forEach(b => {
              const dx = b.position.x - cx;
              const dy = b.position.y - cy;
              const len = Math.max(1, Math.hypot(dx, dy));
              Matter.Body.applyForce(b, b.position, {
                x: (dx / len) * force,
                y: (dy / len) * force,
              });
            });
          // Knock the cyclone into physics so the impulse is visible.
          if (displayModeForToggleRef.current !== 'physics') setMode('physics');
        }}
        onSqueeze={(magnitude) => {
          // Pull orbs toward the screen center.
          if (!engineRef.current) return;
          const cx = window.innerWidth / 2;
          const cy = window.innerHeight / 2;
          const force = 0.008 * (0.4 + magnitude);
          Matter.Composite.allBodies(engineRef.current.world)
            .filter(b => b.label === 'orb')
            .forEach(b => {
              const dx = cx - b.position.x;
              const dy = cy - b.position.y;
              const len = Math.max(1, Math.hypot(dx, dy));
              Matter.Body.applyForce(b, b.position, {
                x: (dx / len) * force,
                y: (dy / len) * force,
              });
            });
          if (displayModeForToggleRef.current !== 'physics') setMode('physics');
        }}
      />

      {/* Footer (fixed bottom) */}
      {!minimalUI && <Footer />}
    </div>
  );
}

export default App;
