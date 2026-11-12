/**
 * A small in-memory cache for lookups against third-party APIs. Pending
 * lookups are shared, so concurrent callers make a single request, and failed
 * lookups aren't cached, so the next caller tries again. It's per server
 * process and resets on restart, which is fine for the cosmetic data it holds.
 */
export function createTtlCache<T>(ttlMs: (value: T) => number, maxEntries = 500) {
  const entries = new Map<string, { value: Promise<T>; expiresAt: number }>();

  return function cached(key: string, load: () => Promise<T>): Promise<T> {
    const hit = entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    if (entries.size >= maxEntries) entries.delete(entries.keys().next().value!);
    const entry = { value: load(), expiresAt: Infinity };
    entries.set(key, entry);
    entry.value.then(
      (value) => {
        entry.expiresAt = Date.now() + ttlMs(value);
      },
      () => {
        if (entries.get(key) === entry) entries.delete(key);
      },
    );
    return entry.value;
  };
}
