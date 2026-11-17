import { describe, expect, it } from 'vitest';
import { dataUrlToBase64, fitSize, isImageFile, MAX_IMAGE_SIDE, MAX_IMAGES, remainingSlots, shouldCapturePaste } from './image';

describe('fitSize', () => {
  it('маленькие картинки не увеличиваются', () => {
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitSize(MAX_IMAGE_SIDE, 100)).toEqual({ width: MAX_IMAGE_SIDE, height: 100 });
  });

  it('альбомная: длинная сторона = 1568, пропорции сохранены', () => {
    expect(fitSize(4032, 3024)).toEqual({ width: 1568, height: 1176 });
  });

  it('портретная: высота = 1568', () => {
    expect(fitSize(3024, 4032)).toEqual({ width: 1176, height: 1568 });
  });

  it('свой предел и очень узкая картинка (минимум 1px)', () => {
    expect(fitSize(2000, 1000, 1000)).toEqual({ width: 1000, height: 500 });
    expect(fitSize(100000, 10)).toEqual({ width: 1568, height: 1 });
  });

  it('некорректные размеры', () => {
    expect(fitSize(0, 100)).toEqual({ width: 0, height: 0 });
    expect(fitSize(Number.NaN, 100)).toEqual({ width: 0, height: 0 });
  });
});

describe('вспомогательные', () => {
  it('remainingSlots', () => {
    expect(remainingSlots(0)).toBe(MAX_IMAGES);
    expect(remainingSlots(3, 5)).toBe(2);
    expect(remainingSlots(7, 5)).toBe(0);
  });

  it('dataUrlToBase64 убирает префикс', () => {
    expect(dataUrlToBase64('data:image/jpeg;base64,QUJD')).toBe('QUJD');
    expect(dataUrlToBase64('QUJD')).toBe('QUJD');
  });

  it('isImageFile', () => {
    expect(isImageFile({ type: 'image/png' })).toBe(true);
    expect(isImageFile({ type: 'text/plain' })).toBe(false);
  });
});

describe('shouldCapturePaste', () => {
  it('без картинок не перехватываем', () => {
    expect(shouldCapturePaste({ targetEditable: false, types: ['text/plain'], imageCount: 0 })).toBe(false);
  });

  it('в поле ввода с текстом в буфере — обычная вставка текста', () => {
    expect(shouldCapturePaste({ targetEditable: true, types: ['text/plain', 'Files'], imageCount: 1 })).toBe(false);
  });

  it('картинка вне поля ввода или без текста в буфере — перехватываем', () => {
    expect(shouldCapturePaste({ targetEditable: false, types: ['text/plain', 'Files'], imageCount: 1 })).toBe(true);
    expect(shouldCapturePaste({ targetEditable: true, types: ['Files'], imageCount: 1 })).toBe(true);
  });
});
