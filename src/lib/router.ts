import { useEffect, useState } from 'react';

/**
 * Tiny client-side router. Vercel rewrites every path to /index.html, so the
 * SPA can read `window.location.pathname` and render the right view.
 *
 * Why hand-rolled instead of react-router?
 *   - Only two routes. Pulling in a dep felt heavier than needed.
 *   - We want `<Link>` calls to *not* reload the page (history.pushState +
 *     a custom event so subscribers re-render).
 */

const NAV_EVENT = 'app:navigate';

export function usePathname(): string {
  const [path, setPath] = useState(() =>
    typeof window === 'undefined' ? '/' : window.location.pathname
  );
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener('popstate', update);
    window.addEventListener(NAV_EVENT, update as EventListener);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(NAV_EVENT, update as EventListener);
    };
  }, []);
  return path;
}

export function navigate(href: string) {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === href) return;
  window.history.pushState({}, '', href);
  window.dispatchEvent(new Event(NAV_EVENT));
  // Always start at the top when changing pages
  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
}

/**
 * <Link> drop-in for `<a>` that uses pushState instead of a full reload.
 * Cmd/Ctrl-click and middle-click still open the link normally (we bail out
 * via `e.defaultPrevented`-style checks).
 */
import { createElement, type AnchorHTMLAttributes, type MouseEvent } from 'react';

export function Link(
  props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
) {
  const { href, onClick, children, ...rest } = props;
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (onClick) onClick(e);
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.button !== 0) return;
    if (props.target && props.target !== '_self') return;
    e.preventDefault();
    navigate(href);
  };
  return createElement('a', { href, onClick: handleClick, ...rest }, children);
}
