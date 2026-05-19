import { useCallback, useRef } from 'react';

export type JoystickSound = 'lever' | 'bubble' | 'whoosh';

interface JoystickProps {
  pulled: boolean;
  /** When true, lever tilts FURTHER (third state — physics drop). */
  extraPull?: boolean;
  onToggle: () => void;
  sound?: JoystickSound;
  /** When true, the joystick is rendered INLINE (position: static, no
   *  scale-up-on-hover trickery) instead of fixed to the bottom-left
   *  corner. Used inside the mobile Footer's left slot. */
  inline?: boolean;
}

/* ---------------------------------------------------------------------------
 * Three synthesized joystick sound effects — all via Web Audio API, no assets.
 *   - "lever"  : heavy mechanical lever pull (the original)
 *   - "bubble" : soft, playful blop — fast pitch arc with a sine body
 *   - "whoosh" : pneumatic noise burst with a filter sweep
 * Each takes a `reverse` flag so the "release" sound mirrors the "engage".
 * ------------------------------------------------------------------------- */

function withCtx(run: (ctx: AudioContext, t: number) => number) {
  try {
    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new AudioCtx();
    const stopAt = run(ctx, ctx.currentTime);
    setTimeout(() => ctx.close(), Math.max(stopAt, 0.4) * 1000 + 200);
  } catch {
    // Silent fail — audio just won't play.
  }
}

function playLeverSound(reverse: boolean) {
  withCtx((ctx, t) => {
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

    return 0.4;
  });
}

function playBubbleSound(reverse: boolean) {
  withCtx((ctx, t) => {
    // Sine "blop" with a fast pitch arc — pluck-y and toy-like.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const startHz = reverse ? 560 : 220;
    const peakHz  = reverse ? 240 : 620;
    const endHz   = reverse ? 180 : 440;
    osc.frequency.setValueAtTime(startHz, t);
    osc.frequency.exponentialRampToValueAtTime(peakHz, t + 0.06);
    osc.frequency.exponentialRampToValueAtTime(endHz, t + 0.22);

    // A gentle lowpass keeps it warm
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2800;
    lp.Q.value = 0.7;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.28, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);

    osc.connect(lp);
    lp.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.28);

    // Tiny harmonic shimmer one octave up for sparkle
    const shimmer = ctx.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(peakHz * 2, t);
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.setValueAtTime(0.0001, t);
    shimmerGain.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
    shimmerGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(ctx.destination);
    shimmer.start(t);
    shimmer.stop(t + 0.15);

    return 0.32;
  });
}

function playWhooshSound(reverse: boolean) {
  withCtx((ctx, t) => {
    // Filtered noise burst — pneumatic / futuristic.
    const dur = 0.36;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      // Pink-ish noise (cheap approximation): smooth by averaging neighbors
      data[i] = (Math.random() * 2 - 1) * 0.7;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    // Bandpass sweep gives it direction (down for engage, up for release)
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;
    const startHz = reverse ? 700 : 4200;
    const endHz   = reverse ? 4400 : 600;
    bp.frequency.setValueAtTime(startHz, t);
    bp.frequency.exponentialRampToValueAtTime(endHz, t + dur * 0.85);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.42, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    noise.connect(bp);
    bp.connect(gain);
    gain.connect(ctx.destination);
    noise.start(t);
    noise.stop(t + dur);

    // Tiny sub-thump on engage for body
    if (!reverse) {
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(90, t);
      sub.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.0001, t);
      subGain.gain.exponentialRampToValueAtTime(0.22, t + 0.012);
      subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      sub.connect(subGain);
      subGain.connect(ctx.destination);
      sub.start(t);
      sub.stop(t + 0.22);
    }

    return dur + 0.1;
  });
}

const SOUND_MAP: Record<JoystickSound, (reverse: boolean) => void> = {
  lever: playLeverSound,
  bubble: playBubbleSound,
  whoosh: playWhooshSound,
};

export default function Joystick({ pulled, extraPull, onToggle, sound = 'lever', inline = false }: JoystickProps) {
  const lastRef = useRef(pulled);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const handle = useCallback(() => {
    const nowPulled = !lastRef.current;
    lastRef.current = nowPulled;
    const play = SOUND_MAP[soundRef.current] || playLeverSound;
    play(!nowPulled);
    onToggle();
  }, [onToggle]);

  const inlineStyle: React.CSSProperties = inline
    ? {
        position: 'static',
        width: 44,
        height: 44,
      }
    : {
        position: 'fixed',
        bottom: 6,
        left: 14,
        width: 56,
        height: 56,
      };

  return (
    <button
      type="button"
      aria-label={pulled ? 'Restore orbital formation' : 'Drop orbs (gravity)'}
      title={pulled ? 'Restore orbital formation' : 'Drop orbs'}
      onClick={handle}
      style={{
        ...inlineStyle,
        padding: 0,
        border: 0,
        background: 'transparent',
        cursor: 'pointer',
        zIndex: 80,
        outline: 'none',
        userSelect: 'none',
        transformOrigin: 'left bottom',
        transition: 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1), filter 0.3s ease',
        filter: 'drop-shadow(0 8px 14px rgba(0, 0, 0, 0.126))',
        // Inline mode: small left margin so the joystick sits cleanly
        // beside the footer divider dot or first link.
        marginLeft: inline ? 0 : undefined,
      }}
      onMouseEnter={(e) => {
        if (inline) return;
        // Grow and tuck a touch closer to the corner via the transform-origin
        e.currentTarget.style.transform = 'translate(-4px, 4px) scale(1.55)';
        e.currentTarget.style.filter = 'drop-shadow(0 14px 22px rgba(0, 0, 0, 0.182))';
      }}
      onMouseLeave={(e) => {
        if (inline) return;
        e.currentTarget.style.transform = 'translate(0, 0) scale(1)';
        e.currentTarget.style.filter = 'drop-shadow(0 8px 14px rgba(0, 0, 0, 0.126))';
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
          // Three visual states matching the three lever states upstream:
          //   neutral (0) → mid pull (1) → fully pulled (2)
          transform: extraPull
            ? 'rotate(-26deg) skewX(3deg)'
            : pulled
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

// Re-export sound players so the control panel can preview each option.
export { playLeverSound, playBubbleSound, playWhooshSound };
