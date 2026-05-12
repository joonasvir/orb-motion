import { useEffect, useRef, useState, useCallback } from 'react';
import Matter from 'matter-js';

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
  const engineRef = useRef<Matter.Engine | null>(null);
  const orbDataRef = useRef<Map<number, OrbData>>(new Map());
  const preloadedImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const coverUrlsRef = useRef<string[]>([]);
  const mouseConstraintRef = useRef<Matter.MouseConstraint | null>(null);
  const overlayImageRef = useRef<HTMLImageElement | null>(null);

  const [orbCount, setOrbCount] = useState(0);
  const [latestUser, setLatestUser] = useState<string | null>(null);
  const [damping, setDamping] = useState(0.005);
  const [moonMode, setMoonMode] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [selectedOrb, setSelectedOrb] = useState<SelectedOrb | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [lightMode, setLightMode] = useState(false);
  const [displayMode, setDisplayMode] = useState<'physics' | 'cyclone' | 'shapes'>('physics');
  const [renderStyle, setRenderStyle] = useState<'simple' | 'glass' | 'shaders'>('glass');
  const [currentShape, setCurrentShape] = useState(0);
  const [showcaseMode, setShowcaseMode] = useState(false);
  const [showcaseOrbCount, setShowcaseOrbCount] = useState(60);
  const [orbSize, setOrbSize] = useState(1.0);

  const SHAPES = ['triangle', 'circle', 'square', 'hexagon', 'heart', 'diamond', 'star', 'spiral', 'grid', 'wave'];

  // Refs for keyboard handler and animation
  const moonModeRef = useRef(moonMode);
  const showControlsRef = useRef(showControls);
  const lightModeRef = useRef(lightMode);
  const displayModeRef = useRef(displayMode);
  const renderStyleRef = useRef(renderStyle);
  const currentShapeRef = useRef(currentShape);
  const cycloneTimeRef = useRef(0);
  const cycloneFocalAngleRef = useRef(0); // Slowly rotating "big zone" position
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

  useEffect(() => { moonModeRef.current = moonMode; }, [moonMode]);
  useEffect(() => { showControlsRef.current = showControls; }, [showControls]);
  useEffect(() => { lightModeRef.current = lightMode; }, [lightMode]);
  useEffect(() => { displayModeRef.current = displayMode; }, [displayMode]);
  useEffect(() => { renderStyleRef.current = renderStyle; }, [renderStyle]);
  useEffect(() => { currentShapeRef.current = currentShape; }, [currentShape]);

  const showcaseOrbCountRef = useRef(showcaseOrbCount);
  const orbSizeRef = useRef(orbSize);
  useEffect(() => { showcaseOrbCountRef.current = showcaseOrbCount; }, [showcaseOrbCount]);
  useEffect(() => { orbSizeRef.current = orbSize; }, [orbSize]);

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

    const canvas = canvasRef.current;
    const scale = MIN_SCALE + Math.random() * (MAX_SCALE - MIN_SCALE);
    const radius = savedOrb?.radius ?? BASE_RADIUS * scale * orbSizeRef.current;
    const posX = savedOrb?.x
      ? Math.min(Math.max(savedOrb.x, radius), window.innerWidth - radius)
      : x ?? Math.random() * (canvas.width - radius * 2) + radius;
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
        // Random X position across the screen width
        const margin = window.innerWidth * 0.05;
        const x = margin + Math.random() * (window.innerWidth - margin * 2);
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

  // Clear all orbs
  const clearOrbs = useCallback(() => {
    if (!engineRef.current) return;
    Matter.Composite.allBodies(engineRef.current.world)
      .filter(b => b.label === 'orb')
      .forEach(orb => {
        orbDataRef.current.delete(orb.id);
        orbAnimDataRef.current.delete(orb.id);
        Matter.Composite.remove(engineRef.current!.world, orb);
      });
    setOrbCount(0);
    setLatestUser(null);
    localStorage.removeItem(ORBS_STORAGE_KEY);
  }, []);

  // Toggle moon gravity
  const toggleMoon = useCallback(() => {
    if (!engineRef.current) return;
    const next = !moonModeRef.current;
    engineRef.current.gravity.y = next ? -0.4 : 1;
    setMoonMode(next);
  }, []);

  // Set displayMode (also resets gravity/moon)
  const setMode = useCallback((mode: 'physics' | 'cyclone' | 'shapes') => {
    if (engineRef.current) engineRef.current.gravity.y = 1;
    setMoonMode(false);
    setDisplayMode(mode);
  }, []);

  // Trigger showcase drop
  const triggerShowcase = useCallback(() => {
    setShowcaseMode(true);
    dropAllOrbsRef.current(showcaseOrbCountRef.current);
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

      const engine = Matter.Engine.create({
        gravity: { x: 0, y: 1 },
        enableSleeping: true,
      });
      engine.positionIterations = 6;
      engine.velocityIterations = 4;
      engineRef.current = engine;

      const wallThickness = 50;
      walls = [
        Matter.Bodies.rectangle(window.innerWidth / 2, window.innerHeight + wallThickness / 2, window.innerWidth * 2, wallThickness, { isStatic: true, label: 'wall' }),
        Matter.Bodies.rectangle(-wallThickness / 2, window.innerHeight / 2, wallThickness, window.innerHeight * 2, { isStatic: true, label: 'wall' }),
        Matter.Bodies.rectangle(window.innerWidth + wallThickness / 2, window.innerHeight / 2, wallThickness, window.innerHeight * 2, { isStatic: true, label: 'wall' }),
      ];
      Matter.Composite.add(engine.world, walls);

      // Always start with 0 orbs
      localStorage.removeItem(ORBS_STORAGE_KEY);

      const mouse = Matter.Mouse.create(canvas);
      const mouseConstraint = Matter.MouseConstraint.create(engine, {
        mouse,
        constraint: { stiffness: 0.2, render: { visible: false } },
      });
      mouse.pixelRatio = dpr;
      Matter.Composite.add(engine.world, mouseConstraint);
      mouseConstraintRef.current = mouseConstraint;

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

        // Quick tap without much movement = click
        if (elapsed < 200 && dist < 10 && mouseDownBody && mouseDownBody.label === 'orb') {
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
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;

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

        // Update cyclone time and focal angle
        if (mode === 'cyclone') {
          cycloneTimeRef.current += 0.016;
          cycloneFocalAngleRef.current += 0.003; // Slowly rotate the "big zone"
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

        // Prepare orb render data (for z-sorting in cyclone mode)
        const orbRenderData: Array<{
          body: Matter.Body;
          orbData: OrbData | undefined;
          drawX: number;
          drawY: number;
          drawAngle: number;
          radius: number;
          zDepth: number;
        }> = [];

        orbs.forEach((body, index) => {
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
            // Cyclone mode: elliptical orbit with z-depth and organic movement
            const time = cycloneTimeRef.current;
            const focalAngle = cycloneFocalAngleRef.current;

            // Initialize extra cyclone properties if not present
            if (animData.ellipseRatioX === undefined) {
              // Assign a FIXED depth layer (0 = far/back/small, 1 = close/front/large)
              animData.zLayer = Math.random();
              animData.joinTime = time; // Track when orb joined for catch-up animation
              animData.ellipseRatioX = 1.0;
              animData.ellipseRatioY = 0.4 + Math.random() * 0.15;
              animData.phaseOffset = Math.random() * Math.PI * 2;
              animData.wobbleSpeed = 0.2 + Math.random() * 0.5;
              animData.wobbleAmount = 20 + Math.random() * 30;
              animData.driftX = (Math.random() - 0.5) * 0.1;
              animData.driftY = (Math.random() - 0.5) * 0.08;
              animData.tiltPhase = Math.random() * Math.PI * 2;
            }

            const zLayer = animData.zLayer ?? 0.5;
            const joinTime = animData.joinTime ?? 0;

            // Catch-up animation: new orbs ease into their cyclone position from top
            const timeSinceJoin = time - joinTime;
            const catchUpProgress = Math.min(1, timeSinceJoin / 3); // 3 seconds to fully catch up
            const catchUpEase = 1 - Math.pow(1 - catchUpProgress, 3); // Cubic ease out

            // Speed based on depth: close (zLayer=1) = faster, far (zLayer=0) = slower
            const depthSpeed = 0.15 + zLayer * 0.35; // 0.15 to 0.5

            // Ellipse size takes more of screen, scaled by depth
            const screenSize = Math.min(window.innerWidth, window.innerHeight);
            const baseRadiusX = (screenSize * 0.38) * (0.7 + zLayer * 0.5);
            const baseRadiusY = baseRadiusX * animData.ellipseRatioY!;

            // Organic movement with depth-based intensity
            const angle = animData.angle + time * depthSpeed;
            const wobbleIntensity = 0.6 + zLayer * 0.6; // Far = subtle, close = more movement
            const wobble1 = Math.sin(time * animData.wobbleSpeed! + animData.phaseOffset!) * animData.wobbleAmount! * wobbleIntensity;
            const wobble2 = Math.sin(time * 0.3 + index * 0.5) * 15 * wobbleIntensity;
            const wobble3 = Math.cos(time * 0.15 + animData.phaseOffset! * 2) * 12 * wobbleIntensity;
            const wobble4 = Math.sin(time * 0.1 + index) * 10 * wobbleIntensity;

            // Slow breathing radius effect
            const breathe = Math.sin(time * 0.12 + index * 0.15) * 30 * wobbleIntensity;

            // Calculate target position on ellipse with organic offsets
            const radiusX = baseRadiusX + wobble1 + breathe;
            const radiusY = baseRadiusY + wobble2 * 0.4 + breathe * 0.3;

            // Gentle drift for organic feel
            const driftOffsetX = Math.sin(time * animData.driftX! + animData.tiltPhase!) * 30 * wobbleIntensity;
            const driftOffsetY = Math.cos(time * animData.driftY! + animData.tiltPhase!) * 20 * wobbleIntensity;

            // Target cyclone position
            const targetX = centerX + Math.cos(angle) * radiusX + driftOffsetX + wobble3;
            const targetY = centerY + Math.sin(angle) * radiusY + driftOffsetY + wobble4;

            // Entry position (from top of screen)
            const entryX = centerX + (Math.random() - 0.5) * 100;
            const entryY = -100;

            // Interpolate between entry and target based on catch-up progress
            drawX = entryX + (targetX - entryX) * catchUpEase;
            drawY = entryY + (targetY - entryY) * catchUpEase;

            // Size based on depth AND position relative to focal point
            // The "big zone" slowly rotates around the ellipse
            const angleFromFocal = Math.abs(Math.sin(angle - focalAngle));
            const focalBoost = 1 + angleFromFocal * 0.5 * zLayer; // Closer orbs get bigger boost near focal

            // Much larger orbs in cyclone mode: 0.4 to 2.0 scale
            const depthScale = (0.4 + zLayer * 1.6) * focalBoost;
            radius = baseRadius * depthScale * catchUpEase; // Scale up as catching up

            // Use fixed z-layer for sorting (never changes)
            zDepth = zLayer;

            // Subtle rotation
            drawAngle = Math.sin(time * 0.2 + animData.phaseOffset!) * 0.15;

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

          orbRenderData.push({ body, orbData, drawX, drawY, drawAngle, radius, zDepth });
        });

        // Sort by z-depth in cyclone mode (far/small first, close/large last)
        if (mode === 'cyclone') {
          orbRenderData.sort((a, b) => a.zDepth - b.zDepth);
        }

        // Render orbs (branches on render style)
        orbRenderData.forEach(({ orbData, drawX, drawY, drawAngle, radius }) => {
          ctx.save();
          ctx.translate(drawX, drawY);
          ctx.rotate(drawAngle);

          if (style === 'simple') {
            // Solid black circle on white bg
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.closePath();
            ctx.fillStyle = '#0a0a0a';
            ctx.fill();
          } else if (style === 'shaders') {
            // Iridescent shader-style blob: chromatic outer halo + bright core
            const halo = radius * 1.6;

            // Soft outer halo (additive-feeling glow)
            const haloGrad = ctx.createRadialGradient(0, 0, radius * 0.4, 0, 0, halo);
            haloGrad.addColorStop(0, 'rgba(255,255,255,0.9)');
            haloGrad.addColorStop(0.55, 'rgba(200,235,255,0.45)');
            haloGrad.addColorStop(0.85, 'rgba(255,200,235,0.18)');
            haloGrad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = haloGrad;
            ctx.beginPath();
            ctx.arc(0, 0, halo, 0, Math.PI * 2);
            ctx.fill();

            // Bright luminous core with subtle blue tint at edge
            const coreGrad = ctx.createRadialGradient(-radius * 0.15, -radius * 0.2, 0, 0, 0, radius);
            coreGrad.addColorStop(0, 'rgba(255,255,255,1)');
            coreGrad.addColorStop(0.55, 'rgba(245,252,255,0.95)');
            coreGrad.addColorStop(0.85, 'rgba(180,220,255,0.55)');
            coreGrad.addColorStop(1, 'rgba(140,180,255,0)');
            ctx.fillStyle = coreGrad;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();

            // Thin chromatic rim (pink/cyan split)
            ctx.lineWidth = Math.max(1, radius * 0.04);
            ctx.strokeStyle = 'rgba(255,200,230,0.35)';
            ctx.beginPath();
            ctx.arc(0, 0, radius * 0.97, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(170,230,255,0.35)';
            ctx.beginPath();
            ctx.arc(0, 0, radius * 1.02, 0, Math.PI * 2);
            ctx.stroke();
          } else {
            // 'glass' (default): image clipped to circle + overlay
            ctx.save();
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            if (orbData?.image) {
              ctx.drawImage(orbData.image, -radius, -radius, radius * 2, radius * 2);
            } else {
              ctx.fillStyle = '#3b82f6';
              ctx.fill();
            }
            ctx.restore();

            if (overlayImageRef.current) {
              ctx.drawImage(overlayImageRef.current, -radius, -radius, radius * 2, radius * 2);
            }
          }

          ctx.restore();
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

        // Update wall positions immediately
        Matter.Body.setPosition(walls[0], { x: window.innerWidth / 2, y: window.innerHeight + wallThickness / 2 });
        Matter.Body.setPosition(walls[1], { x: -wallThickness / 2, y: window.innerHeight / 2 });
        Matter.Body.setPosition(walls[2], { x: window.innerWidth + wallThickness / 2, y: window.innerHeight / 2 });

        // DEBOUNCED: Reposition orbs after resize settles (prevents glitchy physics)
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = window.setTimeout(() => {
          if (displayModeRef.current === 'physics') {
            const orbs = Matter.Composite.allBodies(engine.world).filter(b => b.label === 'orb');
            const floorY = window.innerHeight - 5;

            orbs.forEach(orb => {
              const radius = (orb as any).circleRadius || BASE_RADIUS;
              const minX = radius + 5;
              const maxX = window.innerWidth - radius - 5;
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
  const qrCodeUrl = appLink ? `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(appLink)}` : '';

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <style>{`
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

      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onTouchStart={handleCanvasTouch}
        style={{ display: 'block', cursor: 'pointer', touchAction: 'none' }}
      />

      {/* Left UI */}
      {!showcaseMode && (
        <div style={{
          position: 'absolute', top: 20, left: 20,
          color: renderStyle === 'shaders' ? 'white' : '#1a1a1a',
          fontFamily: 'system-ui, sans-serif', fontSize: 14,
          pointerEvents: 'none', userSelect: 'none',
        }}>
          <div style={{ opacity: 0.5, marginBottom: 4 }}>Apps created today</div>
          <div style={{ fontSize: 48, fontWeight: 'bold' }}>{orbCount}</div>
        </div>
      )}

      {/* Right UI */}
      {!showcaseMode && (
        <div style={{
          position: 'absolute', top: 20, right: 20,
          color: renderStyle === 'shaders' ? 'white' : '#1a1a1a',
          fontFamily: 'system-ui, sans-serif', fontSize: 14,
          pointerEvents: 'none', userSelect: 'none', textAlign: 'right',
        }}>
          {latestUser && (
            <>
              <div style={{ opacity: 0.5, marginBottom: 4 }}>Latest app by</div>
              <div style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 12 }}>{latestUser}</div>
            </>
          )}
          {moonMode && <div style={{ fontSize: 12, color: '#a78bfa', fontWeight: 'bold', marginBottom: 4 }}>MOON MODE</div>}
          {displayMode === 'cyclone' && <div style={{ fontSize: 12, color: '#60a5fa', fontWeight: 'bold', marginBottom: 4 }}>CYCLONE</div>}
          {displayMode === 'shapes' && <div style={{ fontSize: 12, color: '#34d399', fontWeight: 'bold' }}>{SHAPES[currentShape].toUpperCase()}</div>}
        </div>
      )}

      {/* Controls Panel */}
      {showControls && !showcaseMode && (
        <div style={{
          position: 'absolute', bottom: 60, left: 20,
          background: 'rgba(0,0,0,0.8)', padding: 16, borderRadius: 8,
          color: 'white', fontFamily: 'system-ui, sans-serif', fontSize: 12,
          backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)',
          minWidth: 220,
        }}>
          {/* Render style tabs */}
          <div style={{ marginBottom: 6, fontWeight: 'bold', opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1 }}>Style</div>
          <div style={{
            display: 'flex',
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 8,
            padding: 3,
            marginBottom: 16,
            gap: 2,
          }}>
            {(['simple', 'glass', 'shaders'] as const).map((s) => {
              const active = renderStyle === s;
              return (
                <button
                  key={s}
                  onClick={() => setRenderStyle(s)}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    border: 0,
                    borderRadius: 6,
                    background: active ? 'rgba(255,255,255,0.18)' : 'transparent',
                    color: active ? 'white' : 'rgba(255,255,255,0.55)',
                    fontSize: 11,
                    fontWeight: active ? 600 : 500,
                    textTransform: 'capitalize',
                    cursor: 'pointer',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                >
                  {s}
                </button>
              );
            })}
          </div>
          <div style={{ marginBottom: 12, fontWeight: 'bold', opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1 }}>Controls</div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>Damping</span>
              <span>{damping.toFixed(3)}</span>
            </div>
            <input
              type="range" min="0.001" max="0.05" step="0.001"
              value={damping} onChange={(e) => setDamping(parseFloat(e.target.value))}
              style={{ width: '100%', cursor: 'pointer' }}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>Orb Size</span>
              <span>{orbSize.toFixed(1)}x</span>
            </div>
            <input
              type="range" min="0.3" max="2.0" step="0.1"
              value={orbSize} onChange={(e) => setOrbSize(parseFloat(e.target.value))}
              style={{ width: '100%', cursor: 'pointer' }}
            />
          </div>
          <div style={{ marginBottom: 12, marginTop: 16, fontWeight: 'bold', opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1 }}>Showcase (F)</div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>Drop Count</span>
              <span>{showcaseOrbCount}</span>
            </div>
            <input
              type="range" min="10" max="200" step="5"
              value={showcaseOrbCount} onChange={(e) => setShowcaseOrbCount(parseInt(e.target.value))}
              style={{ width: '100%', cursor: 'pointer' }}
            />
          </div>
        </div>
      )}

      {/* Motion sidebar (right) */}
      {showControls && !showcaseMode && (() => {
        const panelStyle: React.CSSProperties = {
          position: 'absolute', bottom: 60, right: 20,
          background: 'rgba(0,0,0,0.8)', padding: 16, borderRadius: 8,
          color: 'white', fontFamily: 'system-ui, sans-serif', fontSize: 12,
          backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)',
          minWidth: 220,
        };
        const sectionLabel: React.CSSProperties = {
          marginBottom: 6, fontWeight: 'bold', opacity: 0.5,
          textTransform: 'uppercase', letterSpacing: 1,
        };
        const segGroup: React.CSSProperties = {
          display: 'flex', background: 'rgba(255,255,255,0.06)',
          borderRadius: 8, padding: 3, gap: 2,
        };
        const segBtn = (active: boolean): React.CSSProperties => ({
          flex: 1, padding: '6px 8px', border: 0, borderRadius: 6,
          background: active ? 'rgba(255,255,255,0.18)' : 'transparent',
          color: active ? 'white' : 'rgba(255,255,255,0.55)',
          fontSize: 11, fontWeight: active ? 600 : 500,
          textTransform: 'capitalize', cursor: 'pointer',
          transition: 'background 0.15s, color 0.15s',
        });
        const actionBtn: React.CSSProperties = {
          flex: 1, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 6, background: 'rgba(255,255,255,0.06)',
          color: 'white', fontSize: 11, fontWeight: 500, cursor: 'pointer',
          transition: 'background 0.15s, border-color 0.15s',
          fontFamily: 'inherit',
        };
        const activePill = (active: boolean): React.CSSProperties => ({
          ...actionBtn,
          background: active ? 'rgba(167,139,250,0.25)' : 'rgba(255,255,255,0.06)',
          borderColor: active ? 'rgba(167,139,250,0.45)' : 'rgba(255,255,255,0.12)',
          color: active ? '#c4b5fd' : 'white',
        });
        return (
          <div style={panelStyle}>
            <div style={sectionLabel}>Motion</div>
            <div style={{ ...segGroup, marginBottom: 16 }}>
              {(['physics', 'cyclone', 'shapes'] as const).map(m => (
                <button key={m} onClick={() => setMode(m)} style={segBtn(displayMode === m)}>
                  {m}
                </button>
              ))}
            </div>

            {displayMode === 'shapes' && (
              <>
                <div style={sectionLabel}>Shape</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
                  <button
                    onClick={() => setCurrentShape((c) => (c - 1 + SHAPES.length) % SHAPES.length)}
                    style={{ ...actionBtn, flex: 0, padding: '6px 10px' }}
                  >‹</button>
                  <div style={{
                    flex: 1, textAlign: 'center', padding: '6px 8px',
                    background: 'rgba(52,211,153,0.18)', borderRadius: 6,
                    color: '#6ee7b7', fontWeight: 600, textTransform: 'uppercase',
                    letterSpacing: 1, fontSize: 11,
                  }}>
                    {SHAPES[currentShape]}
                  </div>
                  <button
                    onClick={() => setCurrentShape((c) => (c + 1) % SHAPES.length)}
                    style={{ ...actionBtn, flex: 0, padding: '6px 10px' }}
                  >›</button>
                </div>
              </>
            )}

            <div style={sectionLabel}>Gravity</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              <button onClick={() => {
                if (engineRef.current) engineRef.current.gravity.y = 1;
                setMoonMode(false);
              }} style={activePill(!moonMode)}>Normal</button>
              <button onClick={toggleMoon} style={activePill(moonMode)}>Moon</button>
            </div>

            <div style={sectionLabel}>Actions</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={clearOrbs} style={actionBtn}>Clear</button>
              <button onClick={triggerShowcase} style={actionBtn}>Showcase</button>
            </div>
          </div>
        );
      })()}

      {/* Instructions */}
      {!showcaseMode && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          color: renderStyle === 'shaders' ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)',
          fontFamily: 'system-ui, sans-serif', fontSize: 12,
          pointerEvents: 'none', userSelect: 'none',
          textAlign: 'center',
        }}>
          Click to drop · Tap orb to view · Press D for controls
        </div>
      )}

      {/* Card Modal */}
      {selectedOrb && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(32px)',
            WebkitBackdropFilter: 'blur(32px)',
            opacity: isClosing ? 0 : 1,
            transition: isClosing ? 'opacity 0.4s ease' : 'none',
            padding: '2rem',
          }}
          onClick={handleCloseCard}
        >
          {/* Card - Vertical Layout */}
          <div
            className={isClosing ? 'card-exit' : 'card-enter'}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 360,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '2.5rem 2rem',
              background: 'linear-gradient(145deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%)',
              backdropFilter: 'blur(60px) saturate(200%)',
              WebkitBackdropFilter: 'blur(60px) saturate(200%)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 32,
              boxShadow: '0 24px 80px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -1px 0 rgba(255,255,255,0.05)',
            }}
          >
            {/* Orb */}
            <div
              className="orb-appear"
              style={{
                width: 160,
                height: 160,
                borderRadius: '50%',
                overflow: 'hidden',
                boxShadow: 'inset -20px -20px 40px rgba(0,0,0,0.5), 0 0 60px rgba(120, 120, 255, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.15)',
                marginBottom: '1.5rem',
              }}
            >
              <img
                src={selectedOrb.data.imageUrl}
                alt="App cover"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <img
                src="/orb-overlay.png"
                alt=""
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                }}
              />
            </div>

            {/* Title */}
            <h1 style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
              fontSize: '1.5rem',
              fontWeight: 600,
              color: 'white',
              textAlign: 'center',
              margin: 0,
              marginBottom: '0.5rem',
              letterSpacing: '-0.02em',
            }}>
              {selectedOrb.data.appTitle}
            </h1>

            {/* Creator */}
            <div style={{
              fontSize: '0.9rem',
              color: 'rgba(255,255,255,0.6)',
              marginBottom: '2rem',
              fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
            }}>
              by <span style={{ color: 'white' }}>{selectedOrb.data.username}</span>
            </div>

            {/* QR Code */}
            {qrCodeUrl && (
              <div style={{
                background: 'white',
                borderRadius: 16,
                padding: 16,
                marginBottom: '1.5rem',
                boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
              }}>
                <img src={qrCodeUrl.replace('120x120', '180x180')} alt="QR Code" style={{ display: 'block', width: 180, height: 180 }} />
              </div>
            )}

            {/* CTA Button */}
            {appLink && (
              <a
                href={appLink}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '1rem',
                  background: 'white',
                  color: 'black',
                  textDecoration: 'none',
                  borderRadius: 16,
                  fontSize: '1rem',
                  fontWeight: 600,
                  textAlign: 'center',
                  transition: 'all 0.2s ease',
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
                  boxShadow: '0 4px 20px rgba(255,255,255,0.2)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.02)';
                  e.currentTarget.style.boxShadow = '0 8px 30px rgba(255,255,255,0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = '0 4px 20px rgba(255,255,255,0.2)';
                }}
              >
                Get on Wabi
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
