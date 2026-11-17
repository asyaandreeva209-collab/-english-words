/** Русское склонение: plural(5, 'слово', 'слова', 'слов') → 'слов'. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = Math.abs(n) % 10;
  const m100 = Math.abs(n) % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** «1 день подряд», «3 дня подряд», «5 дней подряд». */
export function daysInRow(n: number): string {
  return `${n} ${plural(n, 'день', 'дня', 'дней')} подряд`;
}
