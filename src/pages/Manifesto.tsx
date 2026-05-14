import { useEffect } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';

/**
 * The Wabi manifesto. Text content adapted from the public
 * sotabot/website-manifesto repo (the live wabi.ai/manifesto page),
 * presented here as a clean reading experience without the interactive
 * dark-mode scroll, embedded video clips, and clickable highlights.
 *
 * Layout mirrors the landing page: fixed Header on top, fixed Footer on
 * bottom, prose centered in a comfortable measure. Blur-fade-in cascade
 * matches the landing page's first-paint feel.
 */
export default function Manifesto() {
  // Make sure the page background matches the landing surface even on the
  // body element (which other pages may not enforce).
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

  const paragraph = (style?: React.CSSProperties): React.CSSProperties => ({
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
        .blur-in {
          animation: blur-in 1.05s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .blur-in { animation: none !important; }
        }
        .manifesto-em {
          font-style: italic;
          color: #404040;
        }
        .manifesto-strong {
          font-weight: 500;
          color: #0a0a0a;
          background: linear-gradient(180deg, transparent 62%, rgba(250,225,133,0.7) 62%);
          padding: 0 2px;
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

          <p className="blur-in" style={{ ...paragraph(), animationDelay: '200ms' }}>
            Apple told us: there was <span className="manifesto-em">"an app for that"</span>.
            And for a while, it felt like there was. Social media. Games.
            Creation tools. Utilities. The App Store felt boundless.
          </p>

          <p className="blur-in" style={{ ...paragraph(), animationDelay: '260ms' }}>
            But year after year, our home screens remain largely the same.
            A dozen apps produced by a handful of mega-corporations.
          </p>

          <p className="blur-in" style={{ ...paragraph(), animationDelay: '320ms' }}>
            Our tunes. Our furniture. But our apps? They're still
            one-size-fits-all. Made for billions. Not for <span className="manifesto-em">us</span>.
          </p>

          <p className="blur-in" style={{ ...paragraph(), animationDelay: '380ms' }}>
            When software is oriented around <span className="manifesto-em">you</span>… It's freed from the
            incentives that create dark patterns. Freed from the ads and
            unnecessary features that get in the way. And freed from
            disruptive notifications you can't control.
          </p>

          <p className="blur-in" style={{ ...paragraph(), animationDelay: '440ms' }}>
            We believe software has a greater purpose: to help each of us
            live our lives, <span className="manifesto-em">our way</span>.
          </p>

          <p className="blur-in" style={{ ...paragraph(), animationDelay: '500ms' }}>
            That's why we built Wabi. The first <span className="manifesto-em">personal</span> software platform.
          </p>

          <p className="blur-in" style={{ ...paragraph(), animationDelay: '560ms' }}>
            Mini apps based on your taste, habits, and context. Not just
            another <span className="manifesto-em">app for that…</span> but this time, <span className="manifesto-em">an app for you</span>.
          </p>

          <p className="blur-in" style={{ ...paragraph(), animationDelay: '620ms' }}>
            Without walled gardens and lock-in, every app can share… A social
            graph where users can make, share, remix, and collaborate. A
            persistent memory of <span className="manifesto-em">you</span>, that makes every app feel more personal.
          </p>

          <p className="blur-in" style={{ ...paragraph(), animationDelay: '680ms' }}>
            So what will these apps do? In truth, it's hard to say.{' '}
            <span className="manifesto-strong">Because we don't know you yet</span>.
          </p>

          <p className="blur-in" style={{ ...paragraph(), animationDelay: '740ms' }}>
            But we do know this… Someday, we'll look back on the App Store
            like we do on cable TV. A place to find well-produced content
            made for the masses. And that's just fine.
          </p>

          <p className="blur-in" style={{ ...paragraph(), animationDelay: '800ms' }}>
            We believe that a new medium of creativity is upon us… As YouTube
            taught us that video can go far beyond the limited channels of
            TV, and Twitch showed us that <span className="manifesto-em">live</span> is bigger than sports and
            game shows, we believe in a future of software that is far richer
            and more diverse.
          </p>

          <p className="blur-in" style={{
            ...paragraph({ marginBottom: 0 }),
            animationDelay: '880ms',
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
