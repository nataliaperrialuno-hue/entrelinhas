import { useEffect, useState } from 'react';
import { CreationApp } from './features/creation/CreationApp';
import { ReadingApp } from './features/reading/ReadingApp';

const READING_PREFIX = '/leitura/';

function sessionIdFrom(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname.slice(READING_PREFIX.length));
  } catch {
    return null;
  }
}

function NotFound() {
  return (
    <main className="not-found">
      <h1>Página não encontrada</h1>
      <p>Este endereço não corresponde a uma carta nem à página de criação.</p>
      <a href="/">Voltar para o início</a>
    </main>
  );
}

export function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  if (pathname === '/') {
    return <CreationApp />;
  }

  if (pathname.startsWith(READING_PREFIX)) {
    const sessionId = sessionIdFrom(pathname);
    if (sessionId) {
      return <ReadingApp sessionId={sessionId} />;
    }
  }

  return <NotFound />;
}

export default App;
