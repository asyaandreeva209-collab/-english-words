// Тема: применяется к <html data-theme>. Кэш в localStorage — чтобы применить её
// до первого рендера (инлайн-скрипт в index.html запрещён CSP).
import type { Theme } from '../domain/types';

const THEME_KEY = 'theme';

function isTheme(v: unknown): v is Theme {
  return v === 'system' || v === 'light' || v === 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // приватный режим / запрет хранилища — не критично
  }
}

export function applyCachedTheme(): void {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (isTheme(v)) document.documentElement.dataset.theme = v;
  } catch {
    // нет доступа к localStorage — остаётся тема из index.html
  }
}
