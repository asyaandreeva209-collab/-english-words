// Разделы приложения: навигация и маршруты в одном месте.
import type { ReactNode } from 'react';
import { Route, Routes, Navigate } from 'react-router';
import { IconAdd, IconDecks, IconSettings, IconStats, IconToday } from './ui/icons';
import { TodayPage } from './features/today/TodayPage';
import { DecksPage } from './features/decks/DecksPage';
import { DeckPage } from './features/decks/DeckPage';
import { AddPage } from './features/add/AddPage';
import { StudyPage } from './features/study/StudyPage';
import { StatsPage } from './features/stats/StatsPage';
import { SettingsPage } from './features/settings/SettingsPage';

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Сегодня', icon: <IconToday /> },
  { to: '/decks', label: 'Колоды', icon: <IconDecks /> },
  { to: '/add', label: 'Добавить', icon: <IconAdd /> },
  { to: '/stats', label: 'Статистика', icon: <IconStats /> },
  { to: '/settings', label: 'Настройки', icon: <IconSettings /> },
];

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<TodayPage />} />
      <Route path="/decks" element={<DecksPage />} />
      <Route path="/decks/:deckId" element={<DeckPage />} />
      <Route path="/add" element={<AddPage />} />
      <Route path="/study" element={<StudyPage />} />
      <Route path="/stats" element={<StatsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
