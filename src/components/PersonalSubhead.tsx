import { useCallback } from 'react';
import CyclingWord from './CyclingWord';

/**
 * PersonalSubhead — "Wabis are [WORD] / mini-apps for you / and your friends [pile]"
 *
 * Used by the "Make it personal" alt landing.
 *
 * - Cycling word ends line 1 (so width changes don't bounce the lines below)
 * - Facepile mini lives on line 3 next to "friends" with the same lift-on-hover
 *   spring effect as the headline pile in the default landing
 */

interface Props {
  /** Fires true on cycling-word hover-enter, false on leave. */
  onHoverChange?: (hovered: boolean) => void;
}

const WORDS = [
  'useful',
  'fun',
  'powerful',
  'ephemeral',
  'AI-powered',
  'health-conscious',
  'silly',
  'beautiful',
  'one-of-a-kind',
  'inside jokes',
  'as ridiculous as you',
  'just for tonight',
  'a love letter',
  'wabi-sabi',
  'made for your dog',
  'made together',
  'a daily journal',
  'a game',
  'made for two',
  'private',
  'a gift',
  'a secret handshake',
  'a tiny universe',
  'a memory',
];

// Lift-on-hover spring: same recipe as the headline facepile. When a sibling
// is hovered we set CSS variables on every avatar in the group so the row
// reads as a coordinated motion instead of one isolated bump.
const IDS = [1, 2, 3, 4];
const LIFT = -4;           // px lifted by the hovered avatar
const FALLOFF = 0.45;      // each step away from the hovered tip ×0.45
const SCALE = 1.05;
const EASE_IN  = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_OUT = 'cubic-bezier(0.34, 3.85, 0.64, 1)';

function updateSpring(root: HTMLElement | null, hoveredId: number | null) {
  if (!root) return;
  root.querySelectorAll<HTMLElement>('.ps-avatar').forEach(el => {
    const id = Number(el.dataset.avatarId);
    if (!Number.isFinite(id)) return;
    if (hoveredId === null) {
      el.style.setProperty('--avatar-tf', EASE_OUT);
      el.style.setProperty('--shift', '0px');
      el.style.setProperty('--scale-active', '1');
    } else {
      const distance = Math.abs(hoveredId - id);
      const shift = (LIFT * Math.pow(FALLOFF, distance)).toFixed(3);
      el.style.setProperty('--avatar-tf', EASE_IN);
      el.style.setProperty('--shift', `${shift}px`);
      el.style.setProperty('--scale-active', distance === 0 ? String(SCALE) : '1');
    }
  });
}

export default function PersonalSubhead({ onHoverChange }: Props) {
  const handleLeave = useCallback((e: React.PointerEvent<HTMLElement>) => {
    updateSpring(e.currentTarget, null);
  }, []);
  const handleAvatarEnter = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const root = e.currentTarget.parentElement as HTMLElement | null;
    const id = Number(e.currentTarget.dataset.avatarId);
    updateSpring(root, Number.isFinite(id) ? id : null);
  }, []);

  return (
    <>
      <style>{`
        .ps-pile {
          display: inline-flex;
          align-items: center;
          gap: 0;
          vertical-align: -0.22em;
          margin-left: 0.18em;
          pointer-events: auto;
          /* Soft drop shadow under the cluster (matches the headline pile). */
          filter:
            drop-shadow(0 6px 14px rgba(0,0,0,0.12))
            drop-shadow(0 24px 50px rgba(0,0,0,0.22));
        }
        .ps-avatar {
          width: 0.95em;
          height: 0.95em;
          border-radius: 50%;
          overflow: hidden;
          box-shadow: 0 0 0 2px #fff;
          background: #ddd;
          transform-origin: center;
          transform: translateY(var(--shift, 0px)) scale(var(--scale-active, 1));
          transition: transform 320ms var(--avatar-tf, cubic-bezier(0.22, 1, 0.36, 1));
          cursor: pointer;
          will-change: transform;
        }
        .ps-avatar + .ps-avatar { margin-left: -0.3em; }
        .ps-avatar img {
          width: 100%; height: 100%; object-fit: cover; display: block;
          pointer-events: none; user-select: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .ps-avatar { transition: none !important; transform: none !important; }
        }
      `}</style>

      {/* Exact lines per spec. The cycling word ends line 1 so that when it
          changes width only that line resizes — lines 2 and 3 stay anchored
          and the facepile never bounces. */}
      <span style={{ display: 'block' }}>
        Wabis are{' '}
        <CyclingWord
          words={WORDS}
          onHoverChange={onHoverChange}
          // Inherit the subhead's color + weight — no darker treatment so
          // the cycling word reads as part of the line, not pulled forward.
        />
      </span>
      <span style={{ display: 'block' }}>mini-apps for you</span>
      <span style={{ display: 'block' }}>
        and your friends{' '}
        <span
          className="ps-pile"
          aria-hidden="true"
          onPointerLeave={handleLeave}
        >
          {IDS.map(i => (
            <span
              key={i}
              data-avatar-id={i}
              className="ps-avatar"
              style={{ zIndex: 10 - i }}
              onPointerEnter={handleAvatarEnter}
            >
              <img src={`/facepile/avatar-${i}.png`} alt="" />
            </span>
          ))}
        </span>
      </span>
    </>
  );
}
