import { IconSpeaker } from './icons';
import { speak, ttsSupported } from './tts';

export function SpeakButton({ text }: { text: string }) {
  if (!ttsSupported()) return null;
  return (
    <button
      type="button"
      className="btn btn--ghost icon-btn"
      title="Озвучить"
      aria-label="Озвучить"
      // Не забираем фокус при клике мышью: иначе Space в сессии «нажмёт» эту кнопку, а не откроет ответ
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        speak(text);
      }}
    >
      <IconSpeaker />
    </button>
  );
}
