import { useEffect, useState, useRef, useCallback } from 'react';

/**
 * CyclingWord — rotates through a list of words every 2s with a cascading
 * letter-by-letter swap.
 *
 * Motion design (matches the reference recording, ~25fps timeline):
 *   1. OUT — the outgoing word fades + blurs + lifts as a single unit
 *      (~180ms). No per-letter stagger going out, which lets the new word
 *      start before the old one is fully gone (creates a soft crossfade).
 *   2. IN — the incoming word splits into individual letter spans. Each
 *      letter starts at opacity 0, a small Y offset, and a slight blur, then
 *      resolves to crisp. Stagger ≈ 35ms per letter → ~280ms total settle
 *      for a 9-letter word. The cascade reads as "letters typing in from
 *      the left, each one melting into place."
 *
 * The component also exposes `onHoverChange` so the parent can show/hide a
 * hover overlay. The wrapper width animates to the new word's width so the
 * surrounding text re-flows smoothly without bouncing.
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
  /** Optional inline element rendered immediately before the word — gets the
      same enter animation so the icon and word swap together. */
  renderPrefix?: (currentWord: string) => React.ReactNode;
}

// Per-letter cascade delay (ms). Matches the ~35ms stagger seen in the
// reference recording.
const LETTER_STAGGER_MS = 35;
// Base delay before the first incoming letter appears — gives the outgoing
// word a brief head start so the two phases don't slam into each other.
const ENTER_OFFSET_MS = 60;

export default function CyclingWord({
  words,
  intervalMs = 2000,
  onHoverChange,
  className,
  style,
  renderPrefix,
}: Props) {
  const [idx, setIdx] = useState(0);
  const [prevIdx, setPrevIdx] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);

  // Auto-advance unless the user is hovering the word (so a reveal stays put).
  useEffect(() => {
    if (paused) return;
    const t = window.setInterval(() => {
      setIdx(i => {
        setPrevIdx(i);
        return (i + 1) % words.length;
      });
    }, intervalMs);
    return () => window.clearInterval(t);
  }, [paused, intervalMs, words.length]);

  // Drop the previous word from the DOM after its fade-out finishes
  // (~220ms cw-out + a small safety margin). Without this it would linger
  // forever after the swap completes.
  useEffect(() => {
    if (prevIdx === null) return;
    const t = window.setTimeout(() => setPrevIdx(null), 320);
    return () => window.clearTimeout(t);
  }, [prevIdx, idx]);

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
        /* OUT: whole previous word fades + blurs + lifts together (no
           per-letter stagger — matches the reference where the old word
           dissolves as one unit). */
        @keyframes cw-out {
          0%   { opacity: 1; transform: translateY(0);       filter: blur(0); }
          100% { opacity: 0; transform: translateY(-0.18em); filter: blur(3px); }
        }
        /* IN: each letter rises from below, blurred + transparent, resolving
           to crisp. The animation-delay (set inline per letter) creates the
           left-to-right cascade. */
        @keyframes cw-letter-in {
          0% {
            opacity: 0;
            transform: translateY(0.35em);
            filter: blur(4px);
          }
          60% {
            opacity: 1;
            filter: blur(0.6px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
            filter: blur(0);
          }
        }
        .cw-wrap {
          display: inline-flex;
          align-items: baseline;
          vertical-align: baseline;
          position: relative;
          overflow: visible;
          cursor: pointer;
          /* Force pointer events even though the headline wrapper has
             pointer-events: none — without this, hover never fires here. */
          pointer-events: auto;
          transition: width 0.45s cubic-bezier(0.22, 1, 0.36, 1);
          padding-inline: 0.05em;
        }
        /* The visible word — positioned in normal flow. Hosts the in-cascade. */
        .cw-current {
          display: inline-flex;
          align-items: baseline;
          white-space: nowrap;
          will-change: transform, opacity, filter;
        }
        /* The outgoing word — absolutely positioned wrapper over the same
           spot so the new word can start cascading in while the old one
           fades. Pointer events off so it can't intercept hover after the
           swap. The wrapper itself does NOT animate — instead its children
           (icon + text) animate independently so the icon can just fade
           while the text lifts + blurs. */
        .cw-prev {
          position: absolute;
          left: 0;
          top: 0;
          display: inline-flex;
          align-items: baseline;
          white-space: nowrap;
          pointer-events: none;
        }
        /* Outgoing text — lifts + blurs + fades as one unit. */
        .cw-prev-text {
          display: inline-block;
          animation: cw-out 0.22s cubic-bezier(0.4, 0, 0.2, 1) both;
          will-change: transform, opacity, filter;
        }
        /* Outgoing icon — JUST fades, no translate/blur. Mirrors the
           prefix-fade-in so the icon swap reads as a clean crossfade. */
        @keyframes cw-prefix-fade-out {
          0%   { opacity: 1; }
          100% { opacity: 0; }
        }
        .cw-prev-prefix {
          display: inline-block;
          animation: cw-prefix-fade-out 0.22s cubic-bezier(0.4, 0, 0.2, 1) both;
          will-change: opacity;
        }
        /* Each letter inherits the cascade animation; per-letter delay is set
           inline on the element. inline-block is required for the transform/
           filter to apply individually. */
        .cw-letter {
          display: inline-block;
          /* Spaces (rendered as &nbsp;) need width but no animation; we still
             apply it for uniformity — opacity 0→1 on a space is invisible. */
          animation: cw-letter-in 0.36s cubic-bezier(0.22, 1, 0.36, 1) both;
          will-change: transform, opacity, filter;
        }
        /* Prefix element (the inline icon) — simple opacity fade only.
           No translate/blur cascade because the icon is bigger than the
           letters and the lift reads as awkward at that scale. inline-block
           so the img's vertical-align value positions it on the baseline. */
        @keyframes cw-prefix-fade {
          0%   { opacity: 0; }
          100% { opacity: 1; }
        }
        .cw-prefix {
          display: inline-block;
          animation: cw-prefix-fade 0.32s cubic-bezier(0.22, 1, 0.36, 1) both;
          will-change: opacity;
        }
        .cw-measure {
          position: absolute;
          opacity: 0;
          pointer-events: none;
          white-space: nowrap;
          left: 0;
          top: 0;
        }
        /* (Underline removed — the cycling word stands on its own without
            a hover treatment now.) */
        @media (prefers-reduced-motion: reduce) {
          .cw-prev-text   { animation: none; opacity: 0; }
          .cw-prev-prefix { animation: none; opacity: 0; }
          .cw-letter      { animation: none; }
          .cw-prefix      { animation: none; }
        }
      `}</style>
      <span
        className={['cw-wrap', className ?? ''].join(' ')}
        style={{ width: w == null ? 'auto' : `${w}px`, ...style }}
        onPointerEnter={handleEnter}
        onPointerLeave={handleLeave}
      >
        {/* Hidden measurer for the current word — drives the wrap width.
            Includes the prefix so width animates correctly when icons swap. */}
        <span ref={measureRef} className="cw-measure">
          {renderPrefix?.(current)}
          {current}
        </span>
        {/* Outgoing word — fades + blurs + lifts as one unit. Sits absolutely
            on top of the incoming word so the two overlap briefly (matches
            the reference where the new word starts cascading in before the
            old one is fully gone). */}
        {prevIdx !== null && prevIdx !== idx && (
          <span key={`prev-${prevIdx}`} className="cw-prev" aria-hidden="true">
            {renderPrefix && (
              <span className="cw-prev-prefix">{renderPrefix(words[prevIdx])}</span>
            )}
            <span className="cw-prev-text">{words[prevIdx]}</span>
          </span>
        )}
        {/* Incoming word — split into per-letter spans so each can cascade
            in. Re-keyed on `idx` so the animation replays each tick. */}
        <span key={`${idx}-${current}`} className="cw-current">
          {renderPrefix && (
            <span
              className="cw-prefix"
              style={{ animationDelay: `${ENTER_OFFSET_MS}ms` }}
            >
              {renderPrefix(current)}
            </span>
          )}
          {current.split('').map((ch, i) => (
            <span
              key={i}
              className="cw-letter"
              style={{
                // +1 slot if there's a prefix so letters cascade AFTER the icon.
                animationDelay: `${ENTER_OFFSET_MS + (i + (renderPrefix ? 1 : 0)) * LETTER_STAGGER_MS}ms`,
              }}
            >
              {ch === ' ' ? ' ' : ch}
            </span>
          ))}
        </span>
      </span>
    </>
  );
}
