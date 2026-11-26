// In-process caches must not grow for the life of the process.
//
// The reader, clean-page, Google-News and match-detail caches checked their TTL on
// read but never removed anything: every distinct URL a reader ever opened stayed
// in memory until a restart — for the clean page, a whole HTML document per URL, on
// a 1GB box. `remember` is the one place an entry is written, and it drops expired
// entries and then the oldest ones beyond `max`.

/**
 * Set `key` to `value`, first evicting expired entries (by `isExpired`) and then the
 * oldest entries until the map holds at most `max`. A Map iterates in insertion
 * order, and the key is re-inserted, so "oldest" means least recently written.
 */
export function remember<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  max: number,
  isExpired: (entry: V) => boolean,
): void {
  map.delete(key);
  if (map.size >= max) {
    for (const [k, v] of map) if (isExpired(v)) map.delete(k);
  }
  while (map.size >= max) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
  map.set(key, value);
}
