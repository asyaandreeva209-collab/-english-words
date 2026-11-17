// Промпты для Claude (на английском — так модель точнее следует правилам).
import type { EnglishLevel } from '../types';

/** Сколько уже известных слов передаём модели (остальные отфильтруются на клиенте). */
export const KNOWN_WORDS_LIMIT = 1500;

const OUTPUT_RULES = `Output format:
- Respond with JSON matching the schema: {"items": [{"front", "back", "example", "comment", "kind", "uncertain"}]}.
- Use null for fields you have no value for. Do not add any text outside the JSON.`;

export function dictionaryPagePrompt(): string {
  return `You are reading a photo of a handwritten vocabulary notebook page of a Russian-speaking English learner.
Each line usually contains an English word or phrase on the left and its Russian translation on the right
(sometimes separated by a dash, colon or just a space). Some lines may also contain an example sentence or a note.

Rules:
- Read the page line by line, top to bottom. If there are several columns or pages, read each column top to bottom.
- "front": the English word or phrase exactly as written (fix only obvious letter-case issues). Keep "to" before verbs if it is written.
- "back": the Russian translation exactly as written. Keep all variants, separated by commas.
- "example": an English example sentence for this word if it is written on the page, otherwise null.
- "comment": any other note for this line (transcription, grammar note, a second meaning), otherwise null.
- "kind": "phrase" for multi-word expressions, otherwise "word".
- "uncertain": true if any part of the line is hard to read and you are not sure about your reading; otherwise null.
- Never invent words or translations that are not on the page. Do not translate yourself: if the Russian side is
  missing or illegible, put your best reading in "back" and set "uncertain": true; if nothing is readable, set "back" to "".
- Skip headings, dates, page numbers, crossed-out lines and doodles.
- Preserve the order of the lines.

${OUTPUT_RULES}`;
}

export interface ExtractPromptOptions {
  level: EnglishLevel;
  /** Слова, которые пользователь уже учит (не предлагать). */
  knownFronts: string[];
  /** Вставленный текст (если есть). */
  text?: string;
  imageCount: number;
}

/** Последние KNOWN_WORDS_LIMIT слов — их передаём модели. */
export function trimKnownFronts(fronts: string[], limit = KNOWN_WORDS_LIMIT): string[] {
  return fronts.length > limit ? fronts.slice(fronts.length - limit) : fronts;
}

export function extractPrompt(opts: ExtractPromptOptions): string {
  const sources: string[] = [];
  if (opts.imageCount > 0) {
    sources.push(
      `${opts.imageCount === 1 ? 'a screenshot' : `${opts.imageCount} screenshots`} (a movie or YouTube video with subtitles, ` +
        'song lyrics, an article, a chat, etc.)',
    );
  }
  if (opts.text?.trim()) sources.push('the text inside <source_text> tags');
  const known = trimKnownFronts(opts.knownFronts);

  return `You help a Russian-speaking learner of English (CEFR level ${opts.level}) pick useful vocabulary
from ${sources.join(' and ') || 'the provided material'}.

Rules:
- Use only the actual content: subtitles, lyrics, article text. Ignore video player UI, buttons, channel names,
  timestamps, view counts, menus, ads and other interface elements.
- Pick words AND multi-word expressions worth learning: phrasal verbs, idioms, set phrases, collocations, slang.
  Prefer expressions over single words when the meaning is idiomatic.
- The learner's level is ${opts.level}. Skip words that are too easy for this level (for example, basic words a
  ${opts.level} learner surely knows). Skip proper names, numbers and interjections.
- Skip everything from the "already known" list below (also skip other forms of the same word).
- "front": the word or phrase in dictionary form: verbs without "to" and in the infinitive ("give up", not "gave up"),
  nouns in singular unless the expression requires plural. Use "sb"/"sth" placeholders in phrasal patterns if needed.
- "back": the Russian translation that fits this context, 1-3 variants separated by commas. Always in Russian.
- "example": the sentence from the source where it occurred, copied verbatim (do not fix or paraphrase it).
- "comment": optional short note in Russian about the type or usage, e.g. "фразовый глагол", "идиома", "сленг",
  "разговорное"; otherwise null.
- "kind": "phrase" for multi-word expressions, "word" for single words.
- "uncertain": true if the source is hard to read and you are not sure about the exact words; otherwise null.
- Do not invent words that are not in the source. Each word or phrase only once. If nothing is worth learning,
  return an empty list.

Already known (do not suggest): ${known.length ? known.join('; ') : '(none)'}

${OUTPUT_RULES}`;
}

/** Текст пользователя отдельным блоком: в тегах, чтобы модель не путала его с инструкциями. */
export function sourceTextBlock(text: string): string {
  return `<source_text>\n${neutralizeSourceTags(text.trim())}\n</source_text>`;
}

/** Теги source_text внутри текста пользователя ломали бы рамку блока — меняем угловые скобки на квадратные. */
export function neutralizeSourceTags(text: string): string {
  return text.replace(/<(\s*\/?\s*source_text\b[^>]*)>/gi, '[$1]');
}
