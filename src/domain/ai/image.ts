// Подготовка картинок для Claude: поворот по EXIF, длинная сторона ≤ 1568px, JPEG 0.85, base64.

/** Рекомендованный Anthropic предел: больше модель всё равно уменьшит, а запрос станет тяжелее. */
export const MAX_IMAGE_SIDE = 1568;
export const JPEG_QUALITY = 0.85;
export const MAX_IMAGES = 5;

export interface PreparedImage {
  /** base64 JPEG без префикса data: — для API. */
  base64: string;
  /** data: URL для превью. */
  dataUrl: string;
  width: number;
  height: number;
}

/** Размер после уменьшения: длинная сторона ≤ maxSide, пропорции сохраняются, не увеличиваем. */
export function fitSize(width: number, height: number, maxSide = MAX_IMAGE_SIDE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const long = Math.max(width, height);
  if (long <= maxSide) return { width: Math.round(width), height: Math.round(height) };
  const k = maxSide / long;
  return {
    width: Math.max(1, Math.round(width * k)),
    height: Math.max(1, Math.round(height * k)),
  };
}

/** Сколько ещё картинок можно добавить. */
export function remainingSlots(current: number, max = MAX_IMAGES): number {
  return Math.max(0, max - current);
}

export function isImageFile(f: { type: string }): boolean {
  return f.type.startsWith('image/');
}

/**
 * Перехватывать ли вставку как картинку. Если вставляют в поле ввода и в буфере есть текст —
 * это обычная вставка текста (Word/Docs/Excel кладут в буфер ещё и картинку), не трогаем.
 */
export function shouldCapturePaste(opts: { targetEditable: boolean; types: readonly string[]; imageCount: number }): boolean {
  if (opts.imageCount === 0) return false;
  return !(opts.targetEditable && opts.types.includes('text/plain'));
}

/** Отрезает «data:image/jpeg;base64,». */
export function dataUrlToBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(',');
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Не удалось прочитать файл'));
    r.readAsDataURL(blob);
  });
}

/** Браузерная часть: файл → уменьшенный JPEG. Бросает Error с русским текстом. */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    // from-image — повернуть по EXIF (фото с телефона часто «лежат на боку»)
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Не удалось открыть картинку (формат не поддерживается браузером)');
  }
  try {
    const { width, height } = fitSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Браузер не смог обработать картинку');
    // Белый фон: у PNG с прозрачностью в JPEG иначе будет чёрный
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('Браузер не смог сжать картинку');
    const dataUrl = await blobToDataUrl(blob);
    return { base64: dataUrlToBase64(dataUrl), dataUrl, width, height };
  } finally {
    bitmap.close();
  }
}
