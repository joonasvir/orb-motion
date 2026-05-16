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

// Every word here must read as a clean adjective in:
//   "Wabis are [icon] [WORD] mini-apps for you and your friends"
// Each entry pairs a word with a contextual 3D icon (in /public/word-icons/).
// Both rotate together every 2s.
const WORD_ITEMS: Array<{ word: string; icon: string; alt: string }> = [
  { word: 'useful',           icon: '/word-icons/toolbox.png',          alt: 'toolbox' },
  { word: 'fun',              icon: '/word-icons/balloon.png',          alt: 'balloon' },
  { word: 'powerful',         icon: '/word-icons/lightning.png',        alt: 'lightning bolt' },
  { word: 'ephemeral',        icon: '/word-icons/cloud.png',            alt: 'cloud' },
  { word: 'AI-powered',       icon: '/word-icons/robot.png',            alt: 'robot' },
  { word: 'health-conscious', icon: '/word-icons/apple.png',            alt: 'apple' },
  { word: 'silly',            icon: '/word-icons/clown.png',            alt: 'clown' },
  { word: 'beautiful',        icon: '/word-icons/rose.png',             alt: 'rose' },
  { word: 'one-of-a-kind',    icon: '/word-icons/unicorn.png',          alt: 'unicorn' },
  { word: 'private',          icon: '/word-icons/lock.png',             alt: 'lock' },
  { word: 'wabi-sabi',        icon: '/word-icons/tea.png',              alt: 'tea cup' },
  { word: 'nostalgic',        icon: '/word-icons/polaroid-camera.png',  alt: 'polaroid camera' },
  { word: 'intimate',         icon: '/word-icons/candle.png',           alt: 'candle' },
  { word: 'playful',          icon: '/word-icons/dice.png',             alt: 'dice' },
  { word: 'ridiculous',       icon: '/word-icons/banana.png',           alt: 'banana' },
  { word: 'chaotic',          icon: '/word-icons/tornado.png',          alt: 'tornado' },
  { word: 'delightful',       icon: '/word-icons/gift.png',             alt: 'gift' },
  { word: 'handmade',         icon: '/word-icons/scissors.png',         alt: 'scissors' },
  { word: 'bespoke',          icon: '/word-icons/suit.png',             alt: 'suit' },
  { word: 'hilarious',        icon: '/word-icons/mask.png',             alt: 'comedy mask' },
  { word: 'gentle',           icon: '/word-icons/feather.png',          alt: 'feather' },
  { word: 'soulful',          icon: '/word-icons/guitar.png',           alt: 'guitar' },
  { word: 'weird',            icon: '/word-icons/alien.png',            alt: 'alien' },
  { word: 'magical',          icon: '/word-icons/star.png',             alt: 'star' },
  { word: 'loving',           icon: '/word-icons/heart.png',            alt: 'heart' },
  { word: 'collaborative',    icon: '/word-icons/handshake.png',        alt: 'handshake' },
  { word: 'quirky',           icon: '/word-icons/pineapple.png',        alt: 'pineapple' },
  { word: 'thoughtful',       icon: '/word-icons/lightbulb.png',        alt: 'lightbulb' },
  { word: 'joyful',           icon: '/word-icons/sun.png',              alt: 'sun' },
  { word: 'secret',           icon: '/word-icons/key.png',              alt: 'key' },
];
const WORDS = WORD_ITEMS.map(i => i.word);
const ICONS = WORD_ITEMS.reduce<Record<string, { icon: string; alt: string }>>(
  (acc, i) => { acc[i.word] = { icon: i.icon, alt: i.alt }; return acc; },
  {},
);

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
          width: 1.235em;
          height: 1.235em;
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
          renderPrefix={(w) => {
            const meta = ICONS[w];
            if (!meta) return null;
            return (
              <img
                src={meta.icon}
                alt={meta.alt}
                draggable={false}
                style={{
                  // Sit on the baseline of the surrounding text. Bumped to
                  // 1.7875em (30% larger than 1.375em) so the icon registers
                  // as a deliberate inline visual, not a tiny accent.
                  display: 'inline-block',
                  width: '1.7875em',
                  height: '1.7875em',
                  objectFit: 'contain',
                  verticalAlign: '-0.42em',
                  marginRight: '0.22em',
                  // Same drop-shadow recipe as the facepile next to it —
                  // tight near-shadow anchors the icon to the baseline, wide
                  // soft fall-off matches the pile's atmosphere.
                  filter:
                    'drop-shadow(0 6px 14px rgba(0,0,0,0.12)) drop-shadow(0 24px 50px rgba(0,0,0,0.22))',
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              />
            );
          }}
        />
      </span>
      <span style={{ display: 'block' }}>mini-apps for you and</span>
      <span style={{ display: 'block' }}>
        your friends{' '}
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
