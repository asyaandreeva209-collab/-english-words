// Модель данных приложения. Все id — crypto.randomUUID(), даты — number (ms).

export type DeckKind = 'vocab' | 'grammar';

export interface Deck {
  id: string;
  name: string;
  kind: DeckKind;
  description?: string;
  /** Лимит новых СЛОВ в день для колоды (если не задан — глобальный; больше глобального не бывает). */
  newPerDay?: number;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
}

/**
 * vocab: front = EN, back = RU (варианты через , ;)
 * grammar: front = вопрос, back = ответ (мини-markdown)
 */
export interface Note {
  id: string;
  deckId: string;
  front: string;
  back: string;
  example?: string;
  comment?: string;
  transcription?: string;
  createdAt: number;
  updatedAt: number;
}

export type Direction = 'fwd' | 'rev';

/** 0 New, 1 Learning, 2 Review, 3 Relearning — совпадает с ts-fsrs State. */
export type CardState = 0 | 1 | 2 | 3;

export const CardStates = {
  New: 0,
  Learning: 1,
  Review: 2,
  Relearning: 3,
} as const satisfies Record<string, CardState>;

/** Поля планировщика FSRS (даты — ms). */
export interface SrsFields {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: CardState;
  last_review?: number;
}

export interface Card extends SrsFields {
  id: string;
  noteId: string;
  deckId: string;
  direction: Direction;
  suspended?: boolean;
  updatedAt: number;
}

/** 1 Снова, 2 Трудно, 3 Хорошо, 4 Легко. */
export type Rating = 1 | 2 | 3 | 4;

export type ReviewMode = 'flash' | 'type' | 'choice';

export interface ReviewLog {
  id: string;
  cardId: string;
  deckId: string;
  rating: Rating;
  mode: ReviewMode;
  stateBefore: CardState;
  reviewedAt: number;
  elapsedMs?: number;
}

export type Theme = 'system' | 'light' | 'dark';

/** Модели Claude для распознавания фото и подбора слов (id без дат). */
export const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];
export const DEFAULT_CLAUDE_MODEL: ClaudeModel = 'claude-opus-5-5';

export function isClaudeModel(s: unknown): s is ClaudeModel {
  return typeof s === 'string' && (CLAUDE_MODELS as readonly string[]).includes(s);
}

/** Уровень английского по CEFR — ИИ не предлагает слишком простые слова. */
export const ENGLISH_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
export type EnglishLevel = (typeof ENGLISH_LEVELS)[number];

export type GoalMode = 'any' | 'all';

export interface Settings {
  id: 'main';
  /** Лимит новых СЛОВ (заметок) в день. Обратные карточки знакомых слов идут сверх лимита. */
  newPerDay: number;
  desiredRetention: number;
  dayStartsAtHour: number;
  createReverse: boolean;
  claudeApiKey?: string;
  claudeModel: ClaudeModel;
  englishLevel: EnglishLevel;
  theme: Theme;
  ttsEnabled: boolean;
  /** Дневная цель: минут занятий (0 — порог выключен). */
  goalMinutes: number;
  /** Дневная цель: ответов, включая повторы (0 — порог выключен). Оба порога 0 — цели нет. */
  goalCards: number;
  /** any — достаточно любого из включённых порогов, all — нужны все. */
  goalMode: GoalMode;
  /** Когда на этом устройстве последний раз скачивали резервную копию (в бэкап не попадает). */
  lastBackupAt?: number;
  /** До какого момента не напоминать о резервной копии (в бэкап не попадает). */
  backupReminderSnoozeUntil?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'main',
  newPerDay: 10,
  desiredRetention: 0.9,
  dayStartsAtHour: 4,
  createReverse: true,
  claudeModel: DEFAULT_CLAUDE_MODEL,
  englishLevel: 'B1',
  theme: 'system',
  ttsEnabled: true,
  goalMinutes: 5,
  goalCards: 20,
  goalMode: 'any',
};
