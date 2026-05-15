import { useState } from 'react';

/**
 * HandToolbar — bottom-center floating gesture cheatsheet.
 *
 * Three states (state is local; the parent can pre-hide via `enabled={false}`):
 *   - 'expanded': full row of gesture chips
 *   - 'minimized': tiny pill showing "?" + "Gestures" — click to expand
 *   - 'dismissed': hidden completely (until the user toggles Hand mode off+on)
 *
 * Lists the four core gestures wired in HandControl + App.tsx. If you add a
 * gesture there, add a chip here.
 */

export type HandToolbarVisibility = 'expanded' | 'minimized' | 'dismissed';

interface Props {
  /** Don't render at all when the parent says so (e.g. Hand mode is off). */
  enabled: boolean;
}

const GESTURES: Array<{ emoji: string; label: string; effect: string }> = [
  { emoji: '✋', label: 'Open palm',  effect: 'cyclone' },
  { emoji: '✊', label: 'Fist',       effect: 'drop' },
  { emoji: '📏', label: 'Palm height', effect: 'cyclone size' },
  { emoji: '👋', label: 'Clap',       effect: 'reset · rain fresh orbs' },
];

export default function HandToolbar({ enabled }: Props) {
  const [vis, setVis] = useState<HandToolbarVisibility>('expanded');

  if (!enabled || vis === 'dismissed') return null;

  if (vis === 'minimized') {
    return (
      <button
        type="button"
        onClick={() => setVis('expanded')}
        aria-label="Show gestures"
        style={{
          position: 'fixed',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          height: 32,
          padding: '0 14px',
          border: '1px solid rgba(255,255,255,0.55)',
          borderRadius: 999,
          background: 'rgba(255,255,255,0.42)',
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          boxShadow: '0 12px 28px rgba(0,0,0,0.10), 0 4px 8px rgba(0,0,0,0.06)',
          color: '#1e1e1e',
          fontFamily: '"Selecta", system-ui, -apple-system, sans-serif',
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: 0.3,
          cursor: 'pointer',
          zIndex: 96,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ opacity: 0.6 }}>?</span>
        <span>Gestures</span>
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '10px 12px',
        borderRadius: 16,
        background: 'rgba(255,255,255,0.42)',
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border: '1px solid rgba(255,255,255,0.55)',
        boxShadow: '0 18px 36px rgba(0,0,0,0.10), 0 4px 10px rgba(0,0,0,0.06)',
        color: '#1e1e1e',
        fontFamily: '"Selecta", system-ui, -apple-system, sans-serif',
        fontSize: 11,
        zIndex: 96,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        {GESTURES.map(g => (
          <div
            key={g.label}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 9px',
              background: 'rgba(255,255,255,0.55)',
              border: '1px solid rgba(255,255,255,0.6)',
              borderRadius: 999,
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>{g.emoji}</span>
            <span style={{ fontWeight: 500 }}>{g.label}</span>
            <span style={{ opacity: 0.55 }}>→ {g.effect}</span>
          </div>
        ))}
      </div>

      {/* tray controls */}
      <div style={{ display: 'inline-flex', gap: 4, marginLeft: 4, borderLeft: '1px solid rgba(0,0,0,0.08)', paddingLeft: 8 }}>
        <button
          type="button"
          onClick={() => setVis('minimized')}
          aria-label="Minimize gestures"
          title="Minimize"
          style={trayBtn}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setVis('dismissed')}
          aria-label="Dismiss gestures"
          title="Dismiss"
          style={trayBtn}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

const trayBtn: React.CSSProperties = {
  width: 24,
  height: 24,
  border: 0,
  borderRadius: 6,
  background: 'transparent',
  color: 'rgba(30,30,30,0.7)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  padding: 0,
};
