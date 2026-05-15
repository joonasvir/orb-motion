import CyclingWord from './CyclingWord';

/**
 * PersonalSubhead — "Wabis are [cycling word] mini-apps for you and your [pile] friends."
 *
 * Used by the "Make it personal" alt landing. The cycling word swaps every
 * 2s; hovering it triggers the parent's `onHoverChange` so the page-wide
 * curving-text overlay can reveal.
 *
 * The facepile here is a STATIC mini version of the headline pile (no spring
 * hover) — visual echo only, not interactive.
 */

interface Props {
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

export default function PersonalSubhead({ onHoverChange }: Props) {
  return (
    <>
      <style>{`
        .ps-pile {
          display: inline-flex;
          align-items: center;
          gap: 0;
          vertical-align: -0.18em;
          margin-left: 0.18em;
          filter: drop-shadow(0 6px 14px rgba(0,0,0,0.10)) drop-shadow(0 24px 50px rgba(0,0,0,0.18));
        }
        .ps-avatar {
          width: 0.95em;
          height: 0.95em;
          border-radius: 50%;
          overflow: hidden;
          box-shadow: 0 0 0 2px #fff;
          background: #ddd;
        }
        .ps-avatar + .ps-avatar { margin-left: -0.3em; }
        .ps-avatar img {
          width: 100%; height: 100%; object-fit: cover; display: block;
        }
      `}</style>
      <span>
        Wabis are{' '}
        <CyclingWord
          words={WORDS}
          onHoverChange={onHoverChange}
          style={{ fontStyle: 'italic', color: '#1c1c1c' }}
        />{' '}
        mini-apps for you and your{' '}
        <span className="ps-pile" aria-hidden="true">
          {[1, 2, 3, 4].map(i => (
            <span key={i} className="ps-avatar" style={{ zIndex: 5 - i }}>
              <img src={`/facepile/avatar-${i}.png`} alt="" />
            </span>
          ))}
        </span>
        {' '}friends.
      </span>
    </>
  );
}
