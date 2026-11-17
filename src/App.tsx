import { useEffect } from 'react';
import { HashRouter, NavLink } from 'react-router';
import { AppRoutes, NAV_ITEMS } from './routes';
import { useSettings } from './db/hooks';
import { ToastProvider } from './ui/Toast';
import { UpdatePrompt } from './ui/UpdatePrompt';
import { applyTheme } from './ui/theme';

function useApplyTheme(): void {
  const theme = useSettings()?.theme;
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);
}

export function App() {
  useApplyTheme();
  return (
    <HashRouter>
      <ToastProvider extra={<UpdatePrompt />}>
        <div className="app">
          <nav className="nav" aria-label="Разделы">
            <div className="nav__brand">Английские слова</div>
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} className="nav__link">
                {item.icon}
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <main className="main">
            <AppRoutes />
          </main>
        </div>
      </ToastProvider>
    </HashRouter>
  );
}
