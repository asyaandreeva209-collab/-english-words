import { useEffect, useState } from 'react';
import { saveSettings } from '../../db/repo';
import { useSettings } from '../../db/hooks';
import { MAX_LIMIT } from '../../domain/limits';
import { MAX_GOAL_CARDS, MAX_GOAL_MINUTES } from '../../domain/settings';
import {
  CLAUDE_MODELS,
  ENGLISH_LEVELS,
  isClaudeModel,
  type ClaudeModel,
  type EnglishLevel,
  type GoalMode,
  type Settings,
  type Theme,
} from '../../domain/types';
import { LimitInput } from '../../ui/LimitInput';
import { useToast } from '../../ui/Toast';
import { ttsSupported } from '../../ui/tts';
import { downloadBackup } from './downloadBackup';
import { ImportBackup } from './ImportBackup';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Как в системе' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
];

const GOAL_MODES: { value: GoalMode; label: string }[] = [
  { value: 'any', label: 'Что раньше' },
  { value: 'all', label: 'Оба' },
];

const MODEL_LABELS: Record<ClaudeModel, string> = {
  'claude-opus-5-5': 'Opus 5.5 — точнее всего',
  'claude-sonnet-5-5': 'Sonnet 5.5 — дешевле',
  'claude-haiku-4-5': 'Haiku 4.5 — самый дешёвый',
};

const LEVEL_HINTS: Record<EnglishLevel, string> = {
  A1: 'начальный',
  A2: 'элементарный',
  B1: 'средний',
  B2: 'выше среднего',
  C1: 'продвинутый',
};

function usePersisted(): boolean | null {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    if (!navigator.storage?.persisted) return;
    void navigator.storage.persisted().then(setPersisted);
  }, []);
  return persisted;
}

export function SettingsPage() {
  const settings = useSettings();
  const toast = useToast();
  const persisted = usePersisted();

  const setWords = (n: number) => {
    if (!Number.isInteger(n) || n < 0 || n > MAX_LIMIT) return;
    void saveSettings({ newPerDay: n });
  };

  const onExport = async () => {
    try {
      await downloadBackup();
      toast('Файл резервной копии сохранён');
    } catch {
      toast('Не удалось сохранить копию');
    }
  };

  if (!settings) return null;
  const words = settings.newPerDay;

  return (
    <div>
      <h1>Настройки</h1>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Обучение</h2>
        <div className="field">
          <span>Новых слов в день</span>
          <div className="row">
            <input
              type="range"
              min={0}
              max={50}
              value={Math.min(words, 50)}
              onChange={(e) => setWords(Number(e.target.value))}
              className="grow"
              aria-label="Новых слов в день"
            />
            <LimitInput value={words} onCommit={(n) => n !== undefined && setWords(n)} ariaLabel="Новых слов в день, число" />
          </div>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          0 = без новых слов, только повторения (максимум {MAX_LIMIT}). Считаются только слова, которые вы видите впервые.
          {settings.createReverse
            ? ' Обратная карточка (RU→EN) знакомого слова приходит на следующий день и в лимит не входит.'
            : ''}{' '}
          Рекомендуем 5–15: каждое новое слово добавляет повторения на будущие дни. Лимит отдельной колоды
          (в её настройках) не может превысить этот общий лимит.
        </p>
        <label className="checkbox">
          <input type="checkbox" checked={settings.createReverse} onChange={(e) => void saveSettings({ createReverse: e.target.checked })} />
          <span>
            Учить в обе стороны (EN→RU и RU→EN)
            <br />
            <span className="muted small">Применяется к новым словам; уже добавленные не меняются.</span>
          </span>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.ttsEnabled}
            disabled={!ttsSupported()}
            onChange={(e) => void saveSettings({ ttsEnabled: e.target.checked })}
          />
          <span>
            Озвучивать английские слова
            {!ttsSupported() && <span className="muted small"> — не поддерживается этим браузером</span>}
          </span>
        </label>
        <DailyGoalSettings settings={settings} />
      </div>

      <AiSettings settings={settings} />

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Оформление</h2>
        <div className="segmented" role="group" aria-label="Тема">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={settings.theme === t.value}
              onClick={() => void saveSettings({ theme: t.value })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Данные</h2>
        <p className="small" style={{ margin: 0 }}>
          Все слова и прогресс хранятся только в этом браузере на этом устройстве. Данные на телефоне и на компьютере
          не синхронизируются — переносите их через файл резервной копии. Делайте копию время от времени: очистка
          данных браузера удалит всё.
        </p>
        <p className="muted small" style={{ margin: 0 }}>
          Постоянное хранилище:{' '}
          {persisted === null ? 'неизвестно' : persisted ? 'включено' : 'не включено (установите приложение, чтобы браузер не удалял данные)'}
        </p>
        <p className="muted small" style={{ margin: 0 }}>
          {settings.lastBackupAt
            ? `Последняя копия: ${new Date(settings.lastBackupAt).toLocaleString('ru-RU')}`
            : 'Копия ещё не делалась'}
        </p>
        <div className="row">
          <button type="button" className="btn btn--primary" onClick={() => void onExport()}>
            Скачать резервную копию (JSON)
          </button>
        </div>
        <ImportBackup />
        <p className="muted small" style={{ margin: 0 }}>
          Чтобы перенести слова с компьютера на телефон (или обратно): скачайте копию на одном устройстве, передайте
          файл (мессенджер, почта, облако) и на другом нажмите «Восстановить из файла» → «Объединить».
        </p>
      </div>
    </div>
  );
}

function DailyGoalSettings({ settings }: { settings: Settings }) {
  const both = settings.goalMinutes > 0 && settings.goalCards > 0;
  return (
    <div className="field">
      <span>Дневная цель</span>
      <div className="row">
        <LimitInput
          value={settings.goalMinutes}
          onCommit={(n) => n !== undefined && void saveSettings({ goalMinutes: n })}
          max={MAX_GOAL_MINUTES}
          ariaLabel="Дневная цель, минут"
        />
        <span>минут</span>
        <LimitInput
          value={settings.goalCards}
          onCommit={(n) => n !== undefined && void saveSettings({ goalCards: n })}
          max={MAX_GOAL_CARDS}
          ariaLabel="Дневная цель, ответов"
        />
        <span>ответов</span>
      </div>
      {both && (
        <div className="segmented" role="group" aria-label="Когда цель выполнена">
          {GOAL_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={settings.goalMode === m.value}
              onClick={() => void saveSettings({ goalMode: m.value })}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
      <span className="muted small">
        0 = порог выключен; оба 0 — цели и серии дней нет (максимум {MAX_GOAL_MINUTES} мин и {MAX_GOAL_CARDS} ответов).
        Считаются все ответы, включая повторы. Изменение цели пересчитывает серию.
      </span>
    </div>
  );
}

function AiSettings({ settings }: { settings: Settings }) {
  const toast = useToast();
  const [key, setKey] = useState(settings.claudeApiKey ?? '');
  const [showKey, setShowKey] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Ключ поменяли в другой вкладке — подтягиваем
  useEffect(() => {
    setKey(settings.claudeApiKey ?? '');
  }, [settings.claudeApiKey]);

  const saveKey = async (value: string) => {
    const v = value.trim();
    if (v === (settings.claudeApiKey ?? '')) return;
    await saveSettings({ claudeApiKey: v || undefined });
    setCheckResult(null);
  };

  const onCheck = async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      await saveKey(key);
      const { checkKeyWithSdk } = await import('../../domain/ai/client');
      await checkKeyWithSdk(key, settings.claudeModel);
      setCheckResult({ ok: true, text: 'Ключ и модель доступны. Баланс проверь на console.anthropic.com' });
    } catch (err) {
      setCheckResult({ ok: false, text: err instanceof Error ? err.message : 'Не удалось проверить ключ' });
    } finally {
      setChecking(false);
    }
  };

  const onDelete = async () => {
    setKey('');
    setCheckResult(null);
    await saveSettings({ claudeApiKey: undefined });
    toast('Ключ удалён с этого устройства');
  };

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Распознавание фото и текста (Claude)</h2>
      <div className="field">
        <span>Мой уровень английского</span>
        <div className="segmented" role="group" aria-label="Уровень английского">
          {ENGLISH_LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={settings.englishLevel === l}
              title={LEVEL_HINTS[l]}
              onClick={() => void saveSettings({ englishLevel: l })}
            >
              {l}
            </button>
          ))}
        </div>
        <span className="muted small">
          {LEVEL_HINTS[settings.englishLevel]} — ИИ не будет предлагать слишком простые слова из скринов и текстов.
        </span>
      </div>
      <label className="field">
        Модель
        <select
          value={settings.claudeModel}
          onChange={(e) => {
            if (isClaudeModel(e.target.value)) void saveSettings({ claudeModel: e.target.value });
          }}
        >
          {CLAUDE_MODELS.map((m) => (
            <option key={m} value={m}>
              {MODEL_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      <form
        className="stack"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          void onCheck();
        }}
      >
        <label htmlFor="claude-key" className="muted small">
          API-ключ Claude
        </label>
        <div className="row">
          <input
            id="claude-key"
            className="grow"
            type={showKey ? 'text' : 'password'}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="sk-ant-..."
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setCheckResult(null);
            }}
            onBlur={() => void saveKey(key)}
            style={{ width: 'auto' }}
          />
          <button type="button" className="btn" onClick={() => setShowKey((v) => !v)} aria-pressed={showKey}>
            {showKey ? 'Скрыть' : 'Показать'}
          </button>
        </div>
        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={!key.trim() || checking}>
            {checking ? 'Проверяю…' : 'Проверить ключ'}
          </button>
          {settings.claudeApiKey && (
            <button type="button" className="btn btn--danger" onClick={() => void onDelete()}>
              Удалить ключ
            </button>
          )}
        </div>
        {checkResult && (
          <div className={checkResult.ok ? 'small' : 'error-text'} style={checkResult.ok ? { color: 'var(--success)' } : undefined}>
            {checkResult.text}
          </div>
        )}
      </form>
      <p className="small" style={{ margin: 0, color: 'var(--warning)' }}>
        Ключ хранится только на этом устройстве, в данных браузера, и не попадает в резервную копию. Его может увидеть
        любой, у кого есть доступ к этому браузеру.
      </p>
      <p className="muted small" style={{ margin: 0 }}>
        Ключ создаётся на console.anthropic.com. Там же поставьте лимит расходов (Limits), чтобы случайно не
        потратить лишнего. Каждое распознавание — платный запрос к Claude.
      </p>
    </div>
  );
}
