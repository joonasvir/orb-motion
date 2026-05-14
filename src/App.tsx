import { useEffect, useRef, useState, useCallback } from 'react';
import Matter from 'matter-js';
import Header from './components/Header';
import Footer from './components/Footer';
import Joystick from './components/Joystick';

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
  const [currentShape, setCurrentShape] = useState(0);
  const [showcaseMode, setShowcaseMode] = useState(false);
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

  useEffect(() => { moonModeRef.current = moonMode; }, [moonMode]);
  useEffect(() => { showControlsRef.current = showControls; }, [showControls]);
  useEffect(() => { lightModeRef.current = lightMode; }, [lightMode]);
  useEffect(() => { displayModeRef.current = displayMode; }, [displayMode]);
  useEffect(() => { renderStyleRef.current = renderStyle; }, [renderStyle]);
  useEffect(() => { enableOrbTapRef.current = enableOrbTap; }, [enableOrbTap]);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  useEffect(() => { currentShapeRef.current = currentShape; }, [currentShape]);

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
    const urls = coverUrlsRef.current.length > 0 ? coverUrlsRef.current : FALLBACK_ORBS;
    console.log('getRandomCover using', coverUrlsRef.current.length > 0 ? 'API covers' : 'FALLBACK', '- total:', urls.length);
    return urls[Math.floor(Math.random() * urls.length)];
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
  const toggleMoon = useCallback(() => {
    if (!engineRef.current) return;
    const next = !moonModeRef.current;
    engineRef.current.gravity.y = next ? -0.4 : 1;
    setMoonMode(next);
  }, []);

  // Set displayMode (also resets gravity/moon)
  const setMode = useCallback((mode: 'physics' | 'cyclone' | 'orbit' | 'shapes') => {
    if (engineRef.current) engineRef.current.gravity.y = 1;
    setMoonMode(false);
    setDisplayMode(mode);
  }, []);

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

      // Initial 15 orbs — spawn synchronously so every orb gets its cyclone
      // slot on the same frame. The fade-in handles the smooth reveal.
      const INITIAL_DROP_COUNT = 15;
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
        const cx = window.innerWidth * _phoneXFrac;
        const _phoneH = _layout === 'center'
          ? Math.max(390, Math.min(700, window.innerHeight * 0.63))
          : Math.max(420, Math.min(720, window.innerHeight * 0.72));
        const cy = _layout === 'center'
          ? window.innerHeight + window.innerHeight * 0.06 - _phoneH / 2
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
        // Orbital motion centers on the phone for the current layout.
        const _layout = layoutRef.current;
        const _phoneXFrac = _layout === 'left' ? 0.28 : _layout === 'right' ? 0.72 : 0.5;
        const centerX = window.innerWidth * _phoneXFrac;
        const _phoneHcalc = _layout === 'center'
          ? Math.max(390, Math.min(700, window.innerHeight * 0.63))
          : Math.max(420, Math.min(720, window.innerHeight * 0.72));
        const centerY = _layout === 'center'
          // Phone bottom is at viewport-bottom + 6% (overflows), so its center
          // is (windowH + windowH*0.06) - phoneH/2 from the top.
          ? window.innerHeight + window.innerHeight * 0.16 - _phoneHcalc / 2
          // Side layouts: phone is vertically centered.
          : window.innerHeight / 2;

        // Background: white for simple/glass, deep blue gradient for shaders
        if (style === 'shaders') {
          const bg = ctx.createLinearGradient(0, 0, 0, window.innerHeight);
          bg.addColorStop(0, '#1d4ed8');
          bg.addColorStop(1, '#0b1f6a');
          ctx.fillStyle = bg;
        } else {
          ctx.fillStyle = '#ffffff';
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

        orbs.forEach((body, orbIdx) => {
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
            const radiusX = baseR * (1.0 + zLayer * 0.35);
            const radiusY = radiusX * animData.ellipseRatioY!;

            // Even-spacing: each orb's base angle is its index in the current
            // orbs list, mapped to [0, 2π). Single shared angular speed means
            // spacing stays uniform around the ring even as orbs are added.
            const baseAngle = orbs.length > 0 ? (orbIdx / orbs.length) * Math.PI * 2 : 0;
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
              const stagger = orbIdx * 22; // ms per orb
              const FADE_MS = 700;
              const elapsed = nowMs - startMs - stagger;
              const p = Math.max(0, Math.min(1, elapsed / FADE_MS));
              alpha = 1 - Math.pow(1 - p, 3); // ease-out cubic
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

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
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
      `}</style>

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
      {!showcaseMode && <Header />}

      {/* Headline + subhead (positioned per layout) */}
      {!showcaseMode && (
        <div style={{
          position: 'absolute',
          ...(layout === 'center'
            ? {
                top: 'clamp(80px, 9vh, 110px)',
                left: '50%',
                transform: 'translateX(-50%)',
                width: 'min(900px, 94vw)',
                textAlign: 'center' as const,
              }
            : {
                top: '50%',
                transform: 'translateY(-50%)',
                [layout === 'left' ? 'right' : 'left']: 'clamp(56px, 7vw, 140px)',
                width: 'min(440px, 36vw)',
                textAlign: 'center' as const,
              }),
          color: renderStyle === 'shaders' ? '#ffffff' : '#222',
          fontFamily: '"Selecta", system-ui, -apple-system, sans-serif',
          userSelect: 'none',
          zIndex: 20,
          pointerEvents: 'none',
        }}>
          <h1 style={{
            fontFamily: '"Kalice", "Selecta", system-ui, -apple-system, sans-serif',
            fontSize: layout === 'center'
              ? 'clamp(24px, 3.5vw, 50px)'
              : 'clamp(22px, 2.8vw, 40px)',
            lineHeight: 1.11,
            letterSpacing: '-0.01em',
            fontWeight: 400,
            margin: 0,
            marginBottom: 'clamp(10px, 1.4vh, 20px)',
            fontFeatureSettings: '"dlig" 1',
          }}>
            {(() => {
              const facepile = (
                <span
                  className="orb-facepile"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    verticalAlign: '-0.22em',
                    marginRight: '0.22em',
                    marginLeft: '0.05em',
                  }}
                >
                  {(() => {
                  const ids = [1, 2, 3, 4];
                  const selectedId = (activePhone % 4) + 1;
                  const ordered = [selectedId, ...ids.filter((id) => id !== selectedId)];
                  return ordered.map((i, slot) => (
                    <span
                      key={i}
                      className="orb-facepile-avatar"
                      style={{
                        width: '0.88em',
                        height: '0.88em',
                        borderRadius: '50%',
                        overflow: 'hidden',
                        display: 'inline-block',
                        marginLeft: slot === 0 ? 0 : '-0.4em',
                        boxShadow:
                          '0 0 0 1px #fff, 0 3px 6px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
                        position: 'relative',
                        zIndex: 10 - slot,
                        transition: 'margin-left 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
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
                  ));
                })()}
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
          <p style={{
            fontFamily: 'inherit',
            fontSize: 'clamp(13px, 1.3vw, 22px)',
            lineHeight: 1.25,
            letterSpacing: '-0.01em',
            opacity: 0.8,
            color: renderStyle === 'shaders' ? 'rgba(255,255,255,0.75)' : '#636363',
            margin: 0,
            maxWidth: 400,
            marginLeft: 'auto',
            marginRight: 'auto',
            fontWeight: 400,
            fontFeatureSettings: '"dlig" 1',
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
      {!showcaseMode && (() => {
        const PHONE_SOURCES = ['/dash-1.png', '/dash-2.png', '/dash-2.png'];
        // Slot 0 = front, 1 = back-right, 2 = back-left
        const slotForIdentity = (id: number) => (id - activePhone + 3) % 3;
        const slotTransform = (slot: number): React.CSSProperties => {
          if (slot === 0) {
            return { transform: 'translateX(0%) rotate(0deg) scale(1)', zIndex: 3, opacity: 1 };
          }
          if (!phonesFanned) {
            // Pre-fan: behind phones hide behind the front one
            return { transform: 'translateX(0%) rotate(0deg) scale(0.97)', zIndex: slot === 1 ? 2 : 1, opacity: 0 };
          }
          if (slot === 1) {
            return { transform: 'translateX(16%) rotate(6deg) scale(0.94)', zIndex: 2, opacity: 1 };
          }
          // slot 2
          return { transform: 'translateX(-16%) rotate(-6deg) scale(0.94)', zIndex: 1, opacity: 1 };
        };

        return (
          <div
            onClick={() => setActivePhone((p) => (p + 1) % 3)}
            style={{
              position: 'absolute',
              left: layout === 'left' ? '28%' : layout === 'right' ? '72%' : '50%',
              ...(layout === 'center'
                ? { bottom: '-16%', transform: 'translateX(-50%)' }
                : { top: '50%', transform: 'translate(-50%, -50%)' }),
              height: layout === 'center'
                ? 'clamp(390px, 63vh, 700px)'
                : 'clamp(420px, 72vh, 720px)',
              aspectRatio: '402 / 834',
              zIndex: 5,
              cursor: 'pointer',
              userSelect: 'none',
              transition: 'left 0.4s cubic-bezier(0.22, 1, 0.36, 1), top 0.4s cubic-bezier(0.22, 1, 0.36, 1), bottom 0.4s cubic-bezier(0.22, 1, 0.36, 1), height 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
            }}
            title="Click to switch dashboard"
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
          </div>
        );
      })()}

      {/* Floating QR — only in center layout; side layouts render it inside the text column */}
      {!showcaseMode && layout === 'center' && (
        <div
          className="orb-qr-card"
          style={{
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
        const sectionLabel: React.CSSProperties = {
          marginBottom: 8,
          fontWeight: 600,
          fontSize: 10,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          color: 'rgba(30,30,30,0.45)',
        };
        const segGroup: React.CSSProperties = {
          display: 'flex',
          background: 'rgba(0,0,0,0.05)',
          borderRadius: 10,
          padding: 3,
          gap: 2,
        };
        const segBtn = (active: boolean): React.CSSProperties => ({
          flex: 1,
          padding: '8px 8px',
          border: 0,
          borderRadius: 7,
          background: active ? '#1e1e1e' : 'transparent',
          color: active ? '#fff' : 'rgba(30,30,30,0.6)',
          fontSize: 12,
          fontWeight: active ? 600 : 500,
          textTransform: 'capitalize',
          cursor: 'pointer',
          transition: 'background 0.2s ease, color 0.2s ease',
          fontFamily: 'inherit',
        });
        const pillBtn = (active: boolean): React.CSSProperties => ({
          flex: 1,
          padding: '10px 12px',
          border: '1px solid rgba(0,0,0,0.06)',
          borderRadius: 999,
          background: active ? '#1e1e1e' : 'rgba(255,255,255,0.6)',
          color: active ? '#fff' : 'rgba(30,30,30,0.8)',
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
          fontFamily: 'inherit',
        });
        return (
          <div style={{
            position: 'absolute',
            top: 96,
            left: 20,
            width: 280,
            padding: 18,
            borderRadius: 22,
            background: 'rgba(255,255,255,0.62)',
            backdropFilter: 'blur(28px) saturate(180%)',
            WebkitBackdropFilter: 'blur(28px) saturate(180%)',
            border: '1px solid rgba(255,255,255,0.7)',
            boxShadow:
              '0 1px 0 rgba(255,255,255,0.6) inset, 0 -1px 0 rgba(0,0,0,0.04) inset, 0 18px 40px rgba(0,0,0,0.10), 0 4px 12px rgba(0,0,0,0.06)',
            color: '#1e1e1e',
            fontFamily: '"Selecta", system-ui, -apple-system, sans-serif',
            fontSize: 13,
            zIndex: 90,
          }}>
            {/* Layout */}
            <div style={sectionLabel}>Layout</div>
            <div style={{ ...segGroup, marginBottom: 18 }}>
              {(['left', 'center', 'right'] as const).map(l => (
                <button key={l} onClick={() => setLayout(l)} style={segBtn(layout === l)}>{l}</button>
              ))}
            </div>

            {/* Motion */}
            <div style={sectionLabel}>Motion</div>
            <div style={{ ...segGroup, marginBottom: 18, flexWrap: 'wrap' }}>
              {(['physics', 'cyclone', 'orbit', 'shapes'] as const).map(m => (
                <button key={m} onClick={() => setMode(m)} style={segBtn(displayMode === m)}>{m}</button>
              ))}
            </div>

            {displayMode === 'shapes' && (
              <>
                <div style={sectionLabel}>Shape</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
                  <button onClick={() => setCurrentShape((c) => (c - 1 + SHAPES.length) % SHAPES.length)}
                    style={{ ...pillBtn(false), flex: 0, padding: '8px 12px' }}>‹</button>
                  <div style={{
                    flex: 1, textAlign: 'center', padding: '8px 12px',
                    background: 'rgba(0,0,0,0.05)', borderRadius: 999,
                    color: '#1e1e1e', fontWeight: 600, textTransform: 'capitalize', fontSize: 12,
                  }}>{SHAPES[currentShape]}</div>
                  <button onClick={() => setCurrentShape((c) => (c + 1) % SHAPES.length)}
                    style={{ ...pillBtn(false), flex: 0, padding: '8px 12px' }}>›</button>
                </div>
              </>
            )}

            {/* Gravity */}
            <div style={sectionLabel}>Gravity</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
              <button onClick={() => {
                if (engineRef.current) engineRef.current.gravity.y = 1;
                setMoonMode(false);
              }} style={pillBtn(!moonMode)}>Normal</button>
              <button onClick={toggleMoon} style={pillBtn(moonMode)}>Moon</button>
            </div>

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
              style={{ width: '100%', cursor: 'pointer', marginBottom: 16, accentColor: '#1e1e1e' }}
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
      {!showcaseMode && (
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
          pulled={displayMode === 'physics'}
          onToggle={() => {
            const goingToPhysics = displayMode !== 'physics';
            setMode(goingToPhysics ? 'physics' : 'cyclone');
            // When the lever drops the orbs, also rain a few fresh ones from above
            if (goingToPhysics) {
              const newOrbCount = 5 + Math.floor(Math.random() * 3); // 5-7
              for (let i = 0; i < newOrbCount; i++) {
                const delay = i * 90 + Math.random() * 80;
                const x = window.innerWidth * (0.12 + Math.random() * 0.76);
                setTimeout(() => addOrb(x), delay);
              }
            }
          }}
        />
      )}

      {/* Footer (fixed bottom) */}
      {!showcaseMode && <Footer />}
    </div>
  );
}

export default App;
