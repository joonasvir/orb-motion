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
    playLeverSound(!nowPulled);
    onToggle();
  }, [onToggle]);

  return (
    <button
      type="button"
      aria-label={pulled ? 'Restore orbital formation' : 'Drop orbs (gravity)'}
      title={pulled ? 'Restore orbital formation' : 'Drop orbs'}
      onClick={handle}
      style={{
        position: 'fixed',
        bottom: 6,
        left: 14,
        width: 56,
        height: 56,
        padding: 0,
        border: 0,
        background: 'transparent',
        cursor: 'pointer',
        zIndex: 80,
        outline: 'none',
        userSelect: 'none',
        transformOrigin: 'left bottom',
        transition: 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1), filter 0.3s ease',
        filter: 'drop-shadow(0 8px 14px rgba(0,0,0,0.18))',
      }}
      onMouseEnter={(e) => {
        // Grow and tuck a touch closer to the corner via the transform-origin
        e.currentTarget.style.transform = 'translate(-4px, 4px) scale(1.55)';
        e.currentTarget.style.filter = 'drop-shadow(0 14px 22px rgba(0,0,0,0.26))';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translate(0, 0) scale(1)';
        e.currentTarget.style.filter = 'drop-shadow(0 8px 14px rgba(0,0,0,0.18))';
      }}
    >
      <img
        src="/joystick.webp"
        alt=""
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          objectFit: 'contain',
          transformOrigin: '50% 75%',
          transform: pulled
            ? 'rotate(-14deg) skewX(2deg)'
            : 'rotate(0deg) skewX(0deg)',
          transition: 'transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      />
    </button>
  );
}
