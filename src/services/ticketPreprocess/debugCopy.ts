/**
 * Copy temporary preprocess JPEGs to stable cache URIs so UI can show them after cleanup.
 * Used only with __DEV__ preview; delete when done.
 */
import { cacheDirectory, copyAsync, deleteAsync, documentDirectory } from 'expo-file-system/legacy';

export async function copyVariantUrisForDebug(uris: string[]): Promise<string[]> {
  const base = cacheDirectory ?? documentDirectory;
  if (!base) return [...uris];
  const out: string[] = [];
  for (let i = 0; i < uris.length; i++) {
    const dest = `${base}lp-dev-pre-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 9)}.jpg`;
    await copyAsync({ from: uris[i], to: dest });
    out.push(dest);
  }
  return out;
}

export async function deleteDebugVariantUris(uris: string[]): Promise<void> {
  for (const u of uris) {
    if (u.startsWith('file')) {
      try {
        await deleteAsync(u, { idempotent: true });
      } catch {
        /* ignore */
      }
    }
  }
}
