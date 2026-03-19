/**
 * When app becomes active (user returns from background), notify subscribers to refetch.
 * Helps keep latest draw data fresh when user opens app after Supabase was updated.
 */
const listeners = new Set<() => void>();

export function onAppActiveRefetch(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function triggerAppActiveRefetch(): void {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      /* ignore */
    }
  });
}
