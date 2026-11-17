// Тост «Доступно обновление» (vite-plugin-pwa, registerType: 'prompt').
import { useLocation } from 'react-router';
import { useRegisterSW } from 'virtual:pwa-register/react';

/** Как часто спрашивать сервер о новой версии (вкладка может быть открыта днями). */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

export function UpdatePrompt() {
  const { pathname } = useLocation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      window.setInterval(() => {
        if (navigator.onLine) void registration.update().catch(() => {});
      }, UPDATE_CHECK_MS);
    },
  });

  // Во время сессии не отвлекаем: тост появится после выхода из неё
  if (pathname === '/study') return null;

  if (needRefresh) {
    return (
      <div className="toast" role="status">
        <span className="grow">Доступно обновление</span>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => void updateServiceWorker(true)}>
          Обновить
        </button>
        <button type="button" className="btn btn--sm" onClick={() => setNeedRefresh(false)}>
          Позже
        </button>
      </div>
    );
  }
  if (offlineReady) {
    return (
      <div className="toast" role="status">
        <span className="grow">Приложение готово к работе офлайн</span>
        <button type="button" className="btn btn--sm" onClick={() => setOfflineReady(false)}>
          OK
        </button>
      </div>
    );
  }
  return null;
}
