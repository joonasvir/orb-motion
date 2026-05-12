import { WabiWordmark } from './WabiLogo';

const COLOR_DARK = '#191919';
const COLOR_GRAY = '#6b7280';

const socialIcon = (href: string, label: string, d: string) => (
  <a
    key={label}
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={label}
    title={label}
    className="orb-footer-social"
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  </a>
);

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <>
      <style>{`
        .orb-footer {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          z-index: 50;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 24px;
          font-size: 12px;
          color: ${COLOR_GRAY};
          font-family: system-ui, -apple-system, sans-serif;
          pointer-events: none;
        }
        .orb-footer > * { pointer-events: auto; }
        .orb-footer-links {
          display: none;
          align-items: center;
          gap: 24px;
        }
        @media (min-width: 768px) {
          .orb-footer-links { display: flex; }
        }
        .orb-footer-links a {
          color: ${COLOR_GRAY};
          text-decoration: none;
          transition: color 0.2s;
        }
        .orb-footer-links a:hover { color: #374151; }
        .orb-footer-dot { color: #9ca3af; }
        .orb-footer-socials {
          display: flex;
          align-items: center;
          gap: 8px;
          justify-content: flex-end;
        }
        .orb-footer-social {
          width: 32px;
          height: 32px;
          border-radius: 999vw;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #737373;
          text-decoration: none;
          background: linear-gradient(-75deg, rgba(255,255,255,0.05), rgba(255,255,255,0.2), rgba(255,255,255,0.05)), rgba(240,240,240,0.7);
          box-shadow:
            inset 0 0.125em 0.125em rgba(0,0,0,0.05),
            inset 0 -0.125em 0.125em rgba(255,255,255,0.5),
            0 0.25em 0.125em -0.125em rgba(0,0,0,0.15),
            0 0 0.1em 0.25em inset rgba(255,255,255,0.2);
          backdrop-filter: blur(clamp(1px, 0.125em, 4px));
          -webkit-backdrop-filter: blur(clamp(1px, 0.125em, 4px));
          transition: opacity 0.2s, transform 0.2s;
        }
        .orb-footer-social:hover { opacity: 0.85; transform: scale(0.97); }
      `}</style>
      <footer className="orb-footer">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <WabiWordmark style={{ color: COLOR_DARK }} />
        </div>

        <div className="orb-footer-links">
          <a href="https://wabi.ai/news" target="_blank" rel="noopener noreferrer">News</a>
          <span className="orb-footer-dot">•</span>
          <a href="https://wabi.ai/careers" target="_blank" rel="noopener noreferrer">Careers</a>
          <span className="orb-footer-dot">•</span>
          <a href="https://wabi.ai/terms" target="_blank" rel="noopener noreferrer">Terms and Conditions</a>
          <span className="orb-footer-dot">•</span>
          <a href="https://wabi.ai/privacy" target="_blank" rel="noopener noreferrer">Privacy and Cookie Policy</a>
          <span className="orb-footer-dot">•</span>
          <span>Wabi, Inc. ©{year}</span>
        </div>

        <div className="orb-footer-socials">
          {socialIcon(
            'https://x.com/wabi',
            'Wabi on X',
            'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'
          )}
          {socialIcon(
            'https://discord.gg/wabi',
            'Wabi on Discord',
            'M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z'
          )}
          {socialIcon(
            'https://www.instagram.com/gotwabi',
            'Wabi on Instagram',
            'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z'
          )}
          {socialIcon(
            'https://www.tiktok.com/@gotwabi',
            'Wabi on TikTok',
            'M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.51a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15.2a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.98a8.21 8.21 0 0 0 4.76 1.52V7.05a4.84 4.84 0 0 1-1-.36z'
          )}
        </div>
      </footer>
    </>
  );
}
