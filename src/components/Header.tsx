import WabiLogo from './WabiLogo';

const APP_STORE_URL = 'https://apps.apple.com/us/app/wabi-make-mini-apps/id6478775737';

export default function Header() {
  return (
    <>
      <style>{`
        @property --angle-1 {
          syntax: '<angle>';
          inherits: false;
          initial-value: -75deg;
        }
        @property --angle-2 {
          syntax: '<angle>';
          inherits: false;
          initial-value: -45deg;
        }

        .orb-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 24px 24px;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 200;
        }
        @media (min-width: 768px) {
          .orb-nav { padding: 32px 32px; }
        }
        .orb-nav-logo {
          display: flex;
          align-items: center;
          text-decoration: none;
          position: relative;
          top: 0;
          min-width: 140px;
          min-height: 50px;
        }
        .orb-nav-logo .wabi-logo-svg {
          height: 30px;
          width: auto;
          display: block;
          transition: height 0.6s cubic-bezier(0.25, 1, 0.5, 1);
        }
        .orb-nav-logo .wabi-logo-svg .logo-circles {
          opacity: 0.3;
          transition: opacity 0.4s ease;
        }
        .orb-nav-logo .wabi-logo-svg .logo-text {
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        .orb-nav-logo .logo-letter {
          transition: transform 0.2s ease, opacity 0.2s ease;
        }
        .orb-nav-logo .logo-w { transform: translateX(-35px); }
        .orb-nav-logo .logo-a { transform: translateX(-65px); }
        .orb-nav-logo .logo-b { transform: translateX(-90px); }
        .orb-nav-logo .logo-i { transform: translateX(-110px); }
        .orb-nav-logo:hover .logo-letter {
          transform: translateX(0);
          transition: transform 0.5s cubic-bezier(0.25, 1, 0.5, 1) 0.3s, opacity 0.4s ease 0.3s;
        }
        .orb-nav-logo:hover .logo-a { transition-delay: 0.32s; }
        .orb-nav-logo:hover .logo-b { transition-delay: 0.34s; }
        .orb-nav-logo:hover .logo-i { transition-delay: 0.36s; }
        .orb-nav-logo:hover .wabi-logo-svg {
          height: 18px;
          transition: height 0.6s cubic-bezier(0.25, 1, 0.5, 1);
        }
        .orb-nav-logo:hover .wabi-logo-svg .logo-circles { opacity: 0.6; }
        .orb-nav-logo:hover .wabi-logo-svg .logo-text {
          opacity: 0.6;
          transition: opacity 0.4s ease 0.45s;
        }
        @media (min-width: 768px) {
          .orb-nav-logo {
            top: -4px;
            min-width: 200px;
            min-height: 60px;
          }
          .orb-nav-logo .wabi-logo-svg { height: 42px; }
          .orb-nav-logo:hover .wabi-logo-svg { height: 26px; }
        }
        .orb-nav-right {
          display: flex;
          align-items: center;
          gap: 36px;
        }

        /* ===== GLASSMORPHIC BUTTON (verbatim from wabi-website-v2 mini.css) ===== */
        .glass-btn-wrap {
          position: relative;
          z-index: 2;
          border-radius: 999vw;
          background: transparent;
          pointer-events: none;
          transition: all 400ms cubic-bezier(0.25, 1, 0.5, 1);
        }
        .glass-btn-shadow {
          position: absolute;
          width: calc(100% + 2em);
          height: calc(100% + 2em);
          top: calc(0% - 1em);
          left: calc(0% - 1em);
          filter: blur(clamp(2px, 0.125em, 12px));
          overflow: visible;
          pointer-events: none;
        }
        .glass-btn-shadow::after {
          content: '';
          position: absolute;
          z-index: 0;
          inset: 0;
          border-radius: 999vw;
          background: linear-gradient(180deg, rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0.1));
          width: calc(100% - 2em - 0.25em);
          height: calc(100% - 2em - 0.25em);
          top: calc(2em - 0.5em);
          left: calc(2em - 0.875em);
          padding: 0.125em;
          box-sizing: border-box;
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
                  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
                  mask-composite: exclude;
          transition: all 400ms cubic-bezier(0.25, 1, 0.5, 1);
          opacity: 1;
        }
        .glass-btn {
          all: unset;
          cursor: pointer;
          position: relative;
          -webkit-tap-highlight-color: rgba(0, 0, 0, 0);
          pointer-events: auto;
          z-index: 3;
          background: linear-gradient(
            -75deg,
            rgba(255, 255, 255, 0.05),
            rgba(255, 255, 255, 0.2),
            rgba(255, 255, 255, 0.05)
          );
          border-radius: 999vw;
          box-shadow:
            inset 0 0.125em 0.125em rgba(0, 0, 0, 0.05),
            inset 0 -0.125em 0.125em rgba(255, 255, 255, 0.5),
            0 0.25em 0.125em -0.125em rgba(0, 0, 0, 0.2),
            0 0 0.1em 0.25em inset rgba(255, 255, 255, 0.2),
            0 0 0 0 rgba(255, 255, 255, 1);
          backdrop-filter: blur(clamp(1px, 0.125em, 4px));
          -webkit-backdrop-filter: blur(clamp(1px, 0.125em, 4px));
          transition: all 400ms cubic-bezier(0.25, 1, 0.5, 1);
          display: flex;
          align-items: center;
          justify-content: center;
          height: 46px;
          font-family: inherit;
        }
        .glass-btn:hover {
          transform: scale(0.975);
          box-shadow:
            inset 0 0.125em 0.125em rgba(0, 0, 0, 0.05),
            inset 0 -0.125em 0.125em rgba(255, 255, 255, 0.5),
            0 0.15em 0.05em -0.1em rgba(0, 0, 0, 0.25),
            0 0 0.05em 0.1em inset rgba(255, 255, 255, 0.5),
            0 0 0 0 rgba(255, 255, 255, 1);
        }
        .glass-btn span {
          position: relative;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          user-select: none;
          color: rgba(50, 50, 50, 1);
          text-shadow: 0em 0.05em 0.05em rgba(0, 0, 0, 0.05);
          transition: all 400ms cubic-bezier(0.25, 1, 0.5, 1);
          padding-inline: 1.75em;
          font-size: 16px;
          font-weight: 500;
          letter-spacing: -0.18px;
          white-space: nowrap;
        }
        /* Shine */
        .glass-btn span::after {
          content: '';
          display: block;
          position: absolute;
          z-index: 3;
          width: calc(100% - clamp(1px, 0.0625em, 4px));
          height: calc(100% - clamp(1px, 0.0625em, 4px));
          top: calc(0% + clamp(1px, 0.0625em, 4px) / 2);
          left: calc(0% + clamp(1px, 0.0625em, 4px) / 2);
          border-radius: 999vw;
          overflow: clip;
          background: linear-gradient(
            var(--angle-2),
            rgba(255, 255, 255, 0) 0%,
            rgba(255, 255, 255, 0.5) 40% 50%,
            rgba(255, 255, 255, 0) 55%
          );
          mix-blend-mode: screen;
          pointer-events: none;
          background-size: 200% 200%;
          background-position: 0% 50%;
          background-repeat: no-repeat;
          transition:
            background-position 500ms cubic-bezier(0.25, 1, 0.5, 1),
            --angle-2 500ms cubic-bezier(0.25, 1, 0.5, 1);
        }
        .glass-btn:hover span::after {
          background-position: 25% 50%;
        }
        /* Conic outline */
        .glass-btn::after {
          content: '';
          position: absolute;
          z-index: 1;
          inset: 0;
          border-radius: 999vw;
          width: calc(100% + clamp(1px, 0.0625em, 4px));
          height: calc(100% + clamp(1px, 0.0625em, 4px));
          top: calc(0% - clamp(1px, 0.0625em, 4px) / 2);
          left: calc(0% - clamp(1px, 0.0625em, 4px) / 2);
          padding: clamp(1px, 0.0625em, 4px);
          box-sizing: border-box;
          background:
            conic-gradient(
              from var(--angle-1) at 50% 50%,
              rgba(0, 0, 0, 0.5),
              rgba(0, 0, 0, 0) 5% 40%,
              rgba(0, 0, 0, 0.5) 50%,
              rgba(0, 0, 0, 0) 60% 95%,
              rgba(0, 0, 0, 0.5)
            ),
            linear-gradient(180deg, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.5));
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
                  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
                  mask-composite: exclude;
          transition:
            all 400ms cubic-bezier(0.25, 1, 0.5, 1),
            --angle-1 500ms ease;
          box-shadow: inset 0 0 0 calc(clamp(1px, 0.0625em, 4px) / 2) rgba(255, 255, 255, 0.5);
        }
        .glass-btn:hover::after {
          --angle-1: -125deg;
        }
        .glass-btn-wrap:has(button:hover) .glass-btn-shadow {
          filter: blur(clamp(2px, 0.0625em, 6px));
        }
        .glass-btn-wrap:has(button:active) {
          transform: rotate3d(1, 0, 0, 25deg);
        }

        /* Nav header variant — matches Figma 53:5741:
           bright translucent-white pill with a strong top highlight, 1px
           white edge, and a long soft drop shadow that sells the lift.
           Mobile default is compact (140×40); the apple icon is hidden
           below the 768px breakpoint. Desktop bumps to 200×52 / 252×56. */
        .glass-btn-wrap--header { width: 140px; }
        .glass-btn-wrap--header .glass-btn {
          width: 140px;
          height: 40px;
          background:
            linear-gradient(
              -75deg,
              rgba(255, 255, 255, 0.10),
              rgba(255, 255, 255, 0.30),
              rgba(255, 255, 255, 0.10)
            ),
            rgba(255, 255, 255, 0.55);
          border: 1px solid rgba(255, 255, 255, 0.9);
          /* Stack: top highlight + bottom highlight + soft inner glow +
             long soft drop shadow for the floating glass-pill feel. */
          box-shadow:
            inset 0 1px 4px rgba(255, 255, 255, 0.95),
            inset 0 -4px 4px rgba(255, 255, 255, 0.85),
            inset 0 0 14px rgba(229, 229, 229, 0.55),
            0 11px 28px rgba(0, 0, 0, 0.07),
            0 23px 31px rgba(0, 0, 0, 0.05);
          backdrop-filter: blur(clamp(4px, 0.5em, 14px));
          -webkit-backdrop-filter: blur(clamp(4px, 0.5em, 14px));
        }
        .glass-btn-wrap--header .glass-btn span {
          font-family: 'Selecta', system-ui, -apple-system, sans-serif;
          font-size: 13px;
          font-weight: 400;
          letter-spacing: -0.14px;
          color: #363636;
          /* Tighter inset so the label doesn't float in a wide pill. */
          padding-inline: 0.65em;
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        /* Hide the Apple/iOS icon on mobile — the pill is too tight to
           accommodate it without crowding the label. */
        .glass-btn-wrap--header .glass-btn span svg {
          display: none;
        }
        @media (min-width: 768px) {
          /* Desktop pill narrowed (252 → 200) and inner padding pulled in
             so the label sits closer to the edges instead of floating. */
          .glass-btn-wrap--header { width: 200px; }
          .glass-btn-wrap--header .glass-btn {
            width: 200px;
            height: 56px;
          }
          .glass-btn-wrap--header .glass-btn span {
            font-size: 19px;
            letter-spacing: -0.19px;
            padding-inline: 0.7em;
            gap: 7px;
          }
          /* (Apple icon still hidden on desktop too — by request.) */
        }
      `}</style>
      <nav className="orb-nav">
        <a
          href="#"
          onClick={(e) => e.preventDefault()}
          className="orb-nav-logo blur-in"
          style={{ animationDelay: '40ms' }}
        >
          <WabiLogo />
        </a>
        <div className="orb-nav-right blur-in" style={{ animationDelay: '180ms' }}>
          {/* Manifesto link removed from visible UI — press M to access. */}
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none' }}
          >
            <div className="glass-btn-wrap glass-btn-wrap--header">
              <button className="glass-btn">
                <span>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
                    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                  </svg>
                  <span style={{ whiteSpace: 'nowrap' }}>Download for iOS</span>
                </span>
              </button>
              <div className="glass-btn-shadow" />
            </div>
          </a>
        </div>
      </nav>
    </>
  );
}
