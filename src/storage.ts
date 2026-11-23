// Browser storage that never throws (private windows, blocked storage, tests without a DOM).
//
// Where things live, and why:
// - localStorage (kept across visits): only harmless things, like the Client ID and lyric timing.
// - sessionStorage (this tab only, cleared when it closes): the Spotify refresh token and the
//   one-time PKCE values. Every site under liamskillern.github.io shares one storage area, so
//   anything long-lived in localStorage could be read by any other site published there.
// - memory only: the access token.

export interface SafeStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

function wrap(pick: () => Storage): SafeStore {
  return {
    get(key) {
      try {
        return pick().getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        pick().setItem(key, value);
      } catch {
        /* storage unavailable: it just won't be remembered */
      }
    },
    remove(key) {
      try {
        pick().removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

export const local = wrap(() => globalThis.localStorage);
export const session = wrap(() => globalThis.sessionStorage);

/** A Map that forgets its oldest entries past `max` (bounded caches). */
export class LruCache<K, V> {
  private map = new Map<K, V>();
  constructor(private max = 50) {}

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      // Re-insert so it counts as recently used.
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as K);
  }

  get size(): number {
    return this.map.size;
  }
}
