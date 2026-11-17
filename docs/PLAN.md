# План: PWA для изучения английских слов

Интерфейс полностью на русском. Пользователь — русскоязычный студент, ~20 страниц слов в бумажном словарике.

## Решения пользователя
- Платформа: PWA (браузер на телефоне + установка на Windows из Chrome/Edge, офлайн).
- Направления: оба (EN→RU и RU→EN), отдельные карточки; можно отключить в настройках (`createReverse`).
- Лимит новых по умолчанию: **10 слов в день**. Лимит считается в словах (заметках): тратит его только первое знакомство со словом; обратная карточка знакомого слова приходит на следующий день сверх лимита. Лимит колоды ограничен глобальным.
- Фото словарика: да, через Claude API с ключом пользователя (этап 3).
- Доп. фичи: озвучка слов (speechSynthesis, en-US), тёмная тема (светлая/тёмная/системная), лёгкий markdown в грамматических карточках (жирный, курсив, списки, переносы строк — безопасный рендер без innerHTML сырого ввода).

## Окружение
Node v24.18.0, npm 11.16.0. Путь к проекту содержит кириллицу и пробелы → в package.json `"name": "english-words"`.

## Стек
Vite + TypeScript (strict) + React; react-router (HashRouter); dexie + dexie-react-hooks (useLiveQuery); ts-fsrs (FSRS, desiredRetention 0.9); vite-plugin-pwa (registerType 'prompt', тост «Доступно обновление»); zod; обычный CSS с CSS-переменными (тёмная тема через переменные), mobile-first; vitest + fake-indexeddb.

## Структура
```
index.html
vite.config.ts            # VitePWA manifest (ru), иконки 192/512 + maskable
public/icons/*
src/
  main.tsx, App.tsx, routes.tsx
  db/schema.ts            # Dexie, таблицы, версии
  db/repo.ts              # CRUD колод/заметок/карточек, каскадное удаление, создание карточек из заметки
  domain/types.ts
  domain/srs.ts           # обёртка ts-fsrs: newCard(), review(card, rating, now), preview интервалов
  domain/queue.ts         # очередь на сегодня
  domain/parseList.ts     # разбор массовой вставки
  domain/answerCheck.ts   # (этап 2)
  domain/distractors.ts   # (этап 2)
  domain/stats.ts         # (этап 4)
  domain/backup.ts        # экспорт (этап 1 минимально), импорт (этап 4)
  domain/markdown.ts      # безопасный мини-markdown
  domain/ocr/{claude,image}.ts  # (этап 3)
  features/{today,decks,add,study,stats,settings}/
  ui/                     # Button, Modal, Toast и т.п.
  styles/
```

## Модель данных
Все id — `crypto.randomUUID()`, даты — number (ms).
```ts
Deck     { id, name, kind: 'vocab'|'grammar', description?, newPerDay?, createdAt, updatedAt, archived? }
Note     { id, deckId, front, back, example?, comment?, transcription?, createdAt, updatedAt }
         // vocab: front=EN, back=RU (варианты через , ;) ; grammar: front=вопрос, back=ответ (markdown)
Card     { id, noteId, deckId, direction: 'fwd'|'rev', due, stability, difficulty, elapsed_days,
           scheduled_days, learning_steps, reps, lapses, state(0 New,1 Learning,2 Review,3 Relearning),
           last_review?, suspended?, updatedAt }
ReviewLog{ id, cardId, deckId, rating(1..4), mode:'flash'|'type'|'choice', stateBefore, reviewedAt, elapsedMs? }
Settings { id:'main', newPerDay:10 /*слов; до БД v2 было в карточках*/, desiredRetention:0.9, dayStartsAtHour:4,
           createReverse:true, claudeApiKey?, claudeModel, theme:'system'|'light'|'dark', ttsEnabled:true,
           goalMinutes:5 /*0..120, 0=выкл*/, goalCards:20 /*0..500, 0=выкл*/, goalMode:'any'|'all' /*'any'*/,
           lastBackupAt?, backupReminderSnoozeUntil? /*поля устройства: в бэкап не попадают, при импорте не меняются*/ }
```
Индексы: decks 'id, name'; notes 'id, deckId, front'; cards 'id, noteId, deckId, due, state, [deckId+state], [deckId+due]'; reviewLogs 'id, cardId, reviewedAt, deckId'; settings 'id'.
Vocab-слово → карточки fwd + rev (если createReverse). Grammar → только fwd, только режим «Карточки». Удаление заметки удаляет карточки.

## Логика
**parseList(text)** → `{front, back, comment?, error?}[]`: trim, пропуск пустых строк, CRLF; снять нумерацию/маркеры (`1. `, `1) ` — после номера обязателен пробел, чтобы `1.5 - полтора` не ломалось; `-`, `•`); разделитель по приоритету: таб → ` — ` (длинное тире с пробелами) → ` – ` (короткое с пробелами) → ` - ` (дефис с пробелами, не ломать `well-known`) → `:` → `=` → первое `—`/`–` без пробелов; split по первому (так `go – went – gone — идти` → front `go – went – gone`). Comment: текст после `//` (только если перед `//` пробел или начало строки — URL не ломаем) и скобки в конце перевода, если внутри есть латиница (английский пример); `идти (пешком)`, `принимать (решение)` остаются в back. Нет разделителя → error. Дубликаты по нормализованному front в колоде подсвечиваются (по умолчанию «пропустить»).

**answerCheck(input, expected)** → 'exact'|'typo'|'wrong' (этап 2): нормализация (lower, ё→е, trim, схлопнуть пробелы, убрать пунктуацию, для EN убрать ведущие to/a/an/the, убрать скобки); expected делится на варианты по , ; /; Дамерау–Левенштейн: длина ≤4 → 0, 5–8 → 1, >8 → 2.

**FSRS и режимы**: Карточки — Снова/Трудно/Хорошо/Легко (на кнопках интервал). Ввод: exact→Good, typo→Hard (+показать правильно), wrong/подсказка→Again. Тест: верно→Good, неверно→Again.

**queue.ts**: граница дня dayStartsAtHour (4:00). К повторению: state≠New, due≤now, не suspended. Новые: в словах, min(лимит колоды/глобальный) − слова, впервые показанные сегодня (ReviewLog stateBefore=New за сегодня, у заметки нет карточек, введённых раньше); rev знакомых слов — сверх лимита. Learning с due ≤ now — в начало, с due в (now, now+20 мин] — в конец очереди. Перемешивать повторения с новыми; Learning-карточки с due в пределах ~20 мин возвращаются в сессию. fwd/rev одного слова не в одной сессии (sibling burying до завтра).

**streak.ts** (серия дней 🔥 и дневная цель; ничего не хранится — всё из reviewLogs, смена цели пересчитывает историю): цель по умолчанию 5 мин ИЛИ 20 ответов (goalMode 'any' — любой включённый порог, 'all' — все; оба порога 0 — цели и серии нет, огонёк скрыт). Ответы считаются все, включая повторы; время ответа = elapsedMs, обрезанное до 60 с (нет значения — 8 с; время скрытой вкладки в elapsedMs не пишется). Учебный день — dayIndex (дата начала дня в сутках от 1970, DST не влияет), граница dayStartsAtHour. Текущая серия: назад от вчера, выполненный день +1; невыполненное сегодня серию не рвёт. Заморозка: одиночный пропуск прощается, если день перед ним выполнен и среди более поздних прощённых нет ни одного ближе 7 дней («1 прощённый пропуск на любые 7 дней»); два пропуска подряд рвут; прощённый день в серию не считается (❄️ в календаре). Рекорд — проход вперёд по всей истории с тем же правилом (решения о прошлом не меняются от новых данных), не меньше текущей. Загрузка (db/streak.ts): окно 8 недель по индексу reviewedAt, если серия длиннее — дочитывание блоками по 90 дней. «Ещё 5 новых слов» (/study?more=5): extraNew прибавляется к остатку глобального лимита и лимита колоды, без потолка.

**distractors.ts**: 3 варианта из той же колоды (иначе из других), не совпадающих нормализованно с правильным; <4 вариантов → режим недоступен.

**stats.ts**: выучено = Review со stability ≥ 21; в изучении; серия дней — см. streak.ts (готово); прогноз на завтра; гистограмма 7 дней.

## Фото (этап 3)
Ключ в Настройках (хранится локально, предупреждение). fetch `https://api.anthropic.com/v1/messages`, заголовки `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`; модель в настройках (по умолчанию актуальная Sonnet, вариант Haiku). image.ts: длинная сторона ≤1568px, JPEG 0.85, EXIF-поворот; `<input type=file accept="image/*" capture="environment" multiple>`. Промпт: вернуть только JSON `[{"front","back","comment"?,"uncertain"?}]`, валидация zod (учесть обёртку ```json). Результат → общий PreviewTable. Ошибки 401/429/сеть/битый JSON — понятным русским текстом. Кнопка «Проверить ключ».

## Этапы
- **0 Каркас**: vite react-ts, зависимости, strict, layout (таб-бар снизу на телефоне, сайдбар на ПК): Сегодня / Колоды / Добавить / Статистика / Настройки; schema.ts; PWA-манифест и иконки; тёмная тема. Готово: ставится из Edge, открывается офлайн.
- **1 MVP**: CRUD колод (vocab/grammar), список слов с поиском/редактированием; ручное добавление (Enter сохраняет и очищает); массовая вставка parseList + PreviewTable + дубликаты; srs.ts, queue.ts; экран «Сегодня»; сессия «Карточки» (Space — показать, 1–4 — оценки, «Отменить последнюю оценку»); озвучка; markdown в грамматике; настройки (лимит, обратные карточки, тема); экспорт JSON одной кнопкой; navigator.storage.persist(). Объяснение пользователю, почему новые слова дозированно.
- **2 Ввод и тест**: выбор режима и направления; answerCheck; distractors; клавиши 1–4; grammar скрыта в Ввод/Тест.
- **3 Фото**.
- **4 Статистика и бэкап**: stats, импорт «Заменить всё»/«Объединить» (по id, побеждает новее updatedAt), предпросмотр импорта, напоминание о бэкапе. Формат: `{app:'english-words', schemaVersion, exportedAt, decks, notes, cards, reviewLogs, settings без apiKey}`.

## Тесты (vitest, src/domain/*.test.ts)
parseList (все разделители, well-known, нумерация, пустые, без разделителя, CRLF); answerCheck (регистр, ё/е, to go=go, варианты, границы опечаток cat/cut→wrong, beautifull→typo, транспозиция); srs/queue с фиксированным now (лимит, учёт введённых сегодня, граница 4:00, Again возвращает, Easy>Good, sibling burying); stats; backup round-trip/merge/zod; repo с fake-indexeddb (каскад, rev-карточка); markdown (экранирование HTML); ocr с моком fetch.

## Риски
Данные ПК и телефона раздельные (перенос через экспорт/импорт — сказать в UI). Потеря данных при очистке браузера/iOS — persist(), установка PWA, напоминания о бэкапе. API-ключ в браузере — никакого стороннего JS, CSP, совет поставить лимит расходов. Рукопись — обязательный редактируемый предпросмотр. Миграции Dexie при обновлениях.
