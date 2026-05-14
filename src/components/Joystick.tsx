import { useCallback, useRef } from 'react';

interface JoystickProps {
  pulled: boolean;
  onToggle: () => void;
}

// Synthesized lever-pull sound via the Web Audio API — no asset, no dependency.
function playLeverSound(reverse: boolean) {
  try {
    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new AudioCtx();
    const t = ctx.currentTime;

    // Body: low triangle that sweeps down/up
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    if (reverse) {
      osc.frequency.setValueAtTime(70, t);
      osc.frequency.exponentialRampToValueAtTime(160, t + 0.16);
    } else {
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(55, t + 0.2);
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.32, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.32);

    // Click attack: a quick high blip for the lever contact
    const click = ctx.createOscillator();
    click.type = 'square';
    click.frequency.setValueAtTime(720, t);
    click.frequency.exponentialRampToValueAtTime(120, t + 0.04);
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.0001, t);
    clickGain.gain.exponentialRampToValueAtTime(0.18, t + 0.004);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    click.connect(clickGain);
    clickGain.connect(ctx.destination);
    click.start(t);
    click.stop(t + 0.08);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Silent fail
  }
}

export default function Joystick({ pulled, onToggle }: JoystickProps) {
  const lastRef = useRef(pulled);
  const handle = useCallback(() => {
    const nowPulled = !lastRef.current;
    lastRef.current = nowPulled;
    playLeverSound(!nowPulled); // direction
    onToggle();
  }, [onToggle]);

  // Tilt angle of the stick when pulled
  const tilt = pulled ? -22 : 0;

  return (
    <button
      type="button"
      aria-label={pulled ? 'Restore orbital formation' : 'Drop orbs (gravity)'}
      title={pulled ? 'Restore orbital formation' : 'Drop orbs'}
      onClick={handle}
      style={{
        position: 'absolute',
        bottom: 'clamp(72px, 10vh, 110px)',
        left: 'clamp(20px, 3vw, 48px)',
        width: 84,
        height: 84,
        padding: 0,
        border: 0,
        background: 'transparent',
        cursor: 'pointer',
        zIndex: 30,
        outline: 'none',
        userSelect: 'none',
        transformOrigin: 'center bottom',
        transition: 'transform 0.2s ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
    >
      <svg
        viewBox="0 0 100 100"
        width="100%"
        height="100%"
        style={{ display: 'block', filter: 'drop-shadow(0 8px 12px rgba(0,0,0,0.18))' }}
      >
        <defs>
          <linearGradient id="js-base-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#4d4d4d" />
            <stop offset="100%" stopColor="#2c2c2c" />
          </linearGradient>
          <radialGradient id="js-ball-grad" cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor="#ff8a6e" />
            <stop offset="55%" stopColor="#e25540" />
            <stop offset="100%" stopColor="#9b2f1f" />
          </radialGradient>
          <radialGradient id="js-btn-red-grad" cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor="#ff7a5f" />
            <stop offset="100%" stopColor="#b8392a" />
          </radialGradient>
          <radialGradient id="js-btn-gray-grad" cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor="#d4d4d4" />
            <stop offset="100%" stopColor="#888" />
          </radialGradient>
        </defs>

        {/* Base — rounded diamond/cushion */}
        <ellipse cx="50" cy="84" rx="40" ry="11" fill="#1a1a1a" opacity="0.35" />
        <path
          d="M14 70 Q14 56 28 52 L72 52 Q86 56 86 70 L86 78 Q86 86 76 88 L24 88 Q14 86 14 78 Z"
          fill="url(#js-base-grad)"
          stroke="#1a1a1a"
          strokeWidth="0.8"
        />

        {/* Pivot ring (the bellows around the stick) */}
        <ellipse cx="50" cy="60" rx="14" ry="5.5" fill="#3a3a3a" />
        <ellipse cx="50" cy="60" rx="11" ry="4" fill="#2a2a2a" />
        <ellipse cx="50" cy="59" rx="8" ry="2.8" fill="#1f1f1f" />

        {/* Lever (group rotates around the pivot) */}
        <g
          style={{
            transformOrigin: '50px 60px',
            transform: `rotate(${tilt}deg)`,
            transition: 'transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        >
          {/* Stick shaft */}
          <rect x="46" y="22" width="8" height="40" rx="3" fill="#3a3a3a" />
          <rect x="46.5" y="22" width="2" height="40" rx="1" fill="#5a5a5a" opacity="0.7" />
          {/* Ball */}
          <circle cx="50" cy="18" r="14" fill="url(#js-ball-grad)" stroke="#7a1f12" strokeWidth="0.5" />
          <ellipse cx="46" cy="13" rx="4.5" ry="2.6" fill="#fff" opacity="0.55" />
        </g>

        {/* Buttons on the base */}
        <ellipse cx="70" cy="72" rx="6.5" ry="3.2" fill="#1a1a1a" opacity="0.4" />
        <circle cx="70" cy="71" r="5.5" fill="url(#js-btn-red-grad)" stroke="#7a1f12" strokeWidth="0.4" />
        <ellipse cx="30" cy="76" rx="6" ry="3" fill="#1a1a1a" opacity="0.4" />
        <circle cx="30" cy="75" r="5" fill="url(#js-btn-gray-grad)" stroke="#555" strokeWidth="0.4" />
      </svg>
    </button>
  );
}
