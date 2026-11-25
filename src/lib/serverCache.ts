/**
 * A tiny in-process cache for read-heavy, rarely changing API payloads.
 *
 * The portal runs as a single Node process (see compose.yaml), so a module-level
 * cache is enough. Concurrent requests share one in-flight promise, which keeps
 * a burst of phones from stampeding PGlite's single WASM connection.
 *
 * Keep TTLs short: PGlite is the source of truth, and mutations also invalidate
 * the affected keys explicitly.
 */
type CacheEntry = {
  expiresAt: number;
  promise: Promise<unknown>;
};

const MAX_ENTRIES = 60;
const cache = new Map<string, CacheEntry>();

export function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.promise as Promise<T>;

  const promise: Promise<T> = load().catch((error) => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
    throw error;
  });

  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { expiresAt: now + ttlMs, promise });
  return promise;
}

/** Removes a key and every key that starts with the same prefix. */
export function invalidateCache(prefix: string): void {
  for (const key of [...cache.keys()]) {
    if (key === prefix || key.startsWith(`${prefix}:`)) cache.delete(key);
  }
}

export function invalidateAllCaches(): void {
  cache.clear();
}
