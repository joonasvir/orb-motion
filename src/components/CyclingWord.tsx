import { useEffect, useState, useRef, useCallback } from 'react';

/**
 * CyclingWord — rotates through a list of words every 2s with a soft slide+fade.
 *
 * Inline-block with a fixed width per word (no layout shift). The component
 * also exposes `onHoverChange` so the parent can show/hide a hover overlay
 * (the curving spiral text that follows on hover).
 *
 * Each word slides up from below as the previous slides up + fades out. The
 * width is animated to match the new word so the surrounding text re-flows
 * smoothly.
 */

interface Props {
  words: string[];
  intervalMs?: number;
  /** Called whenever pointer hovers/leaves the word. */
  onHoverChange?: (hovered: boolean) => void;
  /** Optional class for italic / serif styling from the parent. */
  className?: string;
  /** Inline style for color / weight overrides. */
  style?: React.CSSProperties;
}

export default function CyclingWord({
  words,
  intervalMs = 2000,
  onHoverChange,
  className,
  style,
}: Props) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  // Auto-advance unless the user is hovering the word (so a reveal stays put).
  useEffect(() => {
    if (paused) return;
    const t = window.setInterval(() => setIdx(i => (i + 1) % words.length), intervalMs);
    return () => window.clearInterval(t);
  }, [paused, intervalMs, words.length]);

  // Measure each word so we can animate the wrapper width smoothly.
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [w, setW] = useState<number | null>(null);
  useEffect(() => {
    if (measureRef.current) {
      const rect = measureRef.current.getBoundingClientRect();
      setW(rect.width);
    }
  }, [idx, words]);

  const handleEnter = useCallback(() => {
    setPaused(true);
    onHoverChange?.(true);
  }, [onHoverChange]);
  const handleLeave = useCallback(() => {
    setPaused(false);
    onHoverChange?.(false);
  }, [onHoverChange]);

  const current = words[idx];

  return (
    <>
      <style>{`
        @keyframes cw-roll-in {
          0%   { opacity: 0; transform: translateY(0.45em); filter: blur(2px); }
          100% { opacity: 1; transform: translateY(0);      filter: blur(0); }
        }
        .cw-wrap {
          display: inline-flex;
          align-items: baseline;
          vertical-align: baseline;
          position: relative;
          overflow: visible;
          cursor: pointer;
          transition: width 0.45s cubic-bezier(0.22, 1, 0.36, 1);
          padding-inline: 0.05em;
        }
        .cw-current {
          display: inline-block;
          animation: cw-roll-in 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
          white-space: nowrap;
        }
        .cw-measure {
          position: absolute;
          opacity: 0;
          pointer-events: none;
          white-space: nowrap;
          left: 0;
          top: 0;
        }
        /* Soft underline that fades up on hover so the word reads as
           interactive without a heavy treatment. */
        .cw-wrap::after {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          bottom: -0.04em;
          height: 1.5px;
          background: currentColor;
          opacity: 0;
          transform: scaleX(0.7);
          transform-origin: center;
          transition: opacity 0.25s ease, transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .cw-wrap:hover::after {
          opacity: 0.35;
          transform: scaleX(1);
        }
      `}</style>
      <span
        className={['cw-wrap', className ?? ''].join(' ')}
        style={{ width: w == null ? 'auto' : `${w}px`, ...style }}
        onPointerEnter={handleEnter}
        onPointerLeave={handleLeave}
      >
        {/* Hidden measurer for the current word — drives the wrap width */}
        <span ref={measureRef} className="cw-measure">{current}</span>
        {/* Visible animated word — re-keyed so the keyframe replays each cycle */}
        <span key={`${idx}-${current}`} className="cw-current">{current}</span>
      </span>
    </>
  );
}
