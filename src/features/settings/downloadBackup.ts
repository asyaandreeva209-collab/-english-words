// Скачивание файла резервной копии и отметка о последней копии.
import { exportAll, saveSettings } from '../../db/repo';
import { backupFileName } from '../../domain/backup';

export async function downloadBackup(): Promise<void> {
  const now = Date.now();
  const data = await exportAll(now);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName(now);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  await saveSettings({ lastBackupAt: now });
}
