import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyCachedTheme } from './ui/theme';
import './styles/global.css';

// Тема из кэша — до первого рендера, чтобы не было вспышки светлой темы.
applyCachedTheme();

// Просим браузер не вычищать IndexedDB при нехватке места.
if (navigator.storage?.persist) {
  void navigator.storage.persisted().then((already) => {
    if (!already) void navigator.storage.persist();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
