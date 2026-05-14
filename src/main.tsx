import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import Manifesto from './pages/Manifesto.tsx'
import { usePathname } from './lib/router'

function Root() {
  const path = usePathname();
  // Single tiny path switch — every URL on the domain falls back to /index.html
  // via vercel.json's rewrite, so this is the only place we route.
  if (path === '/manifesto' || path === '/manifesto/') {
    return <Manifesto />;
  }
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
