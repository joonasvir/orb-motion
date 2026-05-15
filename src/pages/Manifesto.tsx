import { useEffect } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';

/**
 * The full Wabi manifesto. Text extracted verbatim from the public
 * sotabot/website-manifesto repo (the live wabi.ai/manifesto page) by
 * parsing every <h1> and <p> JSX block in components/ManifestoJoined.js
 * and the intro headline in components/Introduction.js.
 *
 * Preserved details:
 *   - The "Visions of a rich, diverse marketplace gave way to a new bundle"
 *     strikethrough that resolves into the "A dozen apps produced by a
 *     handful of mega-corporations" reveal (here shown as a struck-through
 *     phrase followed by the harsher reality).
 *   - The "we pick our clothes. Our tunes. Our furniture. But our apps?"
 *     enumeration.
 *   - The "our way" trailer on the "greater purpose" paragraph.
 *
 * Omitted (out of scope for a reading layout, present on the live site):
 *   - Scroll-driven dark mode transition.
 *   - Inline clickable video clips (cable TV, YouTube, Twitch, Salvador Dalí,
 *     Seinfeld, etc.).
 *   - HighlightMarker scribbles, TextCircled scribbles, shimmer-on-hover.
 *   - The rotating "OurWayText" and rotating Wabi logos.
 */
export default function Manifesto() {
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = '#f0f0f0';
    return () => { document.body.style.background = prev; };
  }, []);

  const proseStyle: React.CSSProperties = {
    fontFamily: '"Kalice", "Selecta", system-ui, -apple-system, sans-serif',
    fontSize: 'clamp(20px, 2.0vw, 28px)',
    lineHeight: 1.45,
    letterSpacing: '-0.01em',
    color: '#1c1c1c',
    margin: 0,
    fontFeatureSettings: '"dlig" 1',
  };
  const para = (style?: React.CSSProperties): React.CSSProperties => ({
    ...proseStyle,
    marginBottom: 'clamp(28px, 3vh, 48px)',
    ...style,
  });

  return (
    <>
      <style>{`
        @keyframes blur-in {
          0%   { opacity: 0; filter: blur(14px); transform: translateY(12px); }
          100% { opacity: 1; filter: blur(0);    transform: translateY(0); }
        }
        .blur-in { animation: blur-in 1.05s cubic-bezier(0.22, 1, 0.36, 1) both; }
        @media (prefers-reduced-motion: reduce) {
          .blur-in { animation: none !important; }
        }
        .m-em { font-style: italic; color: #404040; }
        .m-strong {
          font-weight: 500;
          color: #0a0a0a;
          background: linear-gradient(180deg, transparent 62%, rgba(250,225,133,0.7) 62%);
          padding: 0 2px;
        }
        /* Struck-through phrase — mirrors the cross-out reveal on the live page */
        .m-strike {
          position: relative;
          color: rgba(28,28,28,0.55);
        }
        .m-strike::after {
          content: '';
          position: absolute;
          left: -2px; right: -2px;
          top: 58%;
          height: 2px;
          background: rgba(28,28,28,0.7);
          transform: rotate(-1.2deg);
        }
      `}</style>

      <div style={{ width: '100%', minHeight: '100vh', position: 'relative', background: '#f0f0f0' }}>
        <Header />

        <main style={{
          maxWidth: 760,
          margin: '0 auto',
          padding: 'clamp(140px, 18vh, 200px) clamp(24px, 5vw, 64px) clamp(160px, 18vh, 220px)',
        }}>
          <h1
            className="blur-in"
            style={{
              fontFamily: '"Kalice", "Selecta", system-ui, -apple-system, sans-serif',
              fontSize: 'clamp(48px, 7.5vw, 96px)',
              lineHeight: 1.02,
              letterSpacing: '-0.025em',
              fontWeight: 400,
              margin: '0 0 clamp(48px, 6vh, 80px)',
              color: '#0a0a0a',
              animationDelay: '60ms',
            }}
          >
            Many<br />years ago,
          </h1>

          <p className="blur-in" style={{ ...para(), animationDelay: '180ms' }}>
            Apple told us: there was <span className="m-em">"an app for that"</span>.
            And for a while, it felt like there was. Social media. Games. Creation
            tools. Utilities. The App Store felt boundless.
          </p>

          <p className="blur-in" style={{ ...para(), animationDelay: '240ms' }}>
            But year after year, our home screens remain largely the same.{' '}
            <span className="m-strike">Visions of a rich, diverse marketplace gave way to a new <span className="m-em">bundle</span>.</span>{' '}
            A dozen apps produced by a handful of mega-corporations.
          </p>

          <p className="blur-in" style={{ ...para(), animationDelay: '300ms' }}>
            And so, we pick our clothes. Our tunes. Our furniture. But our apps?
            They're still one-size-fits-all. Made for billions. Not for{' '}
            <span className="m-em">us</span>.
          </p>

          <p className="blur-in" style={{ ...para(), animationDelay: '360ms' }}>
            When software is oriented around <span className="m-em">you</span>… It's
            freed from the incentives that create dark patterns. Freed from the ads
            and unnecessary features that get in the way. And freed from disruptive
            notifications you can't control.
          </p>

          <p className="blur-in" style={{ ...para(), animationDelay: '420ms' }}>
            We believe software has a greater purpose: to help each of us live our
            lives, <span className="m-em">our way</span>.
          </p>

          <p className="blur-in" style={{ ...para(), animationDelay: '480ms' }}>
            That's why we built Wabi. The first <span className="m-em">personal</span>{' '}
            software platform.
          </p>

          <p className="blur-in" style={{ ...para(), animationDelay: '540ms' }}>
            Mini apps based on your taste, habits, and context. Not just another{' '}
            <span className="m-em">app for that…</span> but this time,{' '}
            <span className="m-em">an app for you</span>.
          </p>

          <p className="blur-in" style={{ ...para(), animationDelay: '600ms' }}>
            Without walled gardens and lock-in, every app can share… A social graph
            where users can make, share, remix, and collaborate. A persistent memory
            of <span className="m-em">you</span>, that makes every app feel more
            personal.
          </p>

          <p className="blur-in" style={{ ...para(), animationDelay: '660ms' }}>
            So what will these apps do? In truth, it's hard to say.{' '}
            <span className="m-strong">Because we don't know you yet</span>.
          </p>

          <p className="blur-in" style={{ ...para(), animationDelay: '720ms' }}>
            But we do know this… Someday, we'll look back on the App Store like we
            do on cable TV. A place to find well-produced content made for the
            masses. And that's just fine.
          </p>

          <p className="blur-in" style={{ ...para(), animationDelay: '780ms' }}>
            We believe that a new medium of creativity is upon us… As YouTube taught
            us that video can go far beyond the limited channels of TV, and Twitch
            showed us that <span className="m-em">live</span> is bigger than sports
            and game shows, we believe in a future of software that is far richer and
            more diverse.
          </p>

          <p className="blur-in" style={{
            ...para({ marginBottom: 0 }),
            animationDelay: '860ms',
            fontSize: 'clamp(24px, 2.6vw, 36px)',
            color: '#0a0a0a',
            lineHeight: 1.3,
          }}>
            A future where software is made for all of us, by all of us.
          </p>
        </main>

        <Footer />
      </div>
    </>
  );
}
