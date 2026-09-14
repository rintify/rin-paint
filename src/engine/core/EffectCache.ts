import type { EffectCacheStore } from '../layer-types/types';

interface Entry { value: unknown; bytes: number; dispose?: () => void }

/** CPU解析結果などを保持する、容量制限付きの共通LRUキャッシュ。 */
export class EffectCache implements EffectCacheStore {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  hits = 0;
  misses = 0;

  constructor(private readonly limitBytes = 96 * 1024 * 1024) {}

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) { this.misses++; return undefined; }
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits++;
    return entry.value as T;
  }

  set<T>(key: string, value: T, bytes: number, dispose?: () => void): void {
    const previous = this.entries.get(key);
    if (previous) {
      this.bytes -= previous.bytes;
      previous.dispose?.();
      this.entries.delete(key);
    }
    this.entries.set(key, { value, bytes: Math.max(0, bytes), dispose });
    this.bytes += Math.max(0, bytes);
    while (this.bytes > this.limitBytes && this.entries.size > 1) {
      const oldest = this.entries.entries().next().value as [string, Entry] | undefined;
      if (!oldest) break;
      this.entries.delete(oldest[0]);
      this.bytes -= oldest[1].bytes;
      oldest[1].dispose?.();
    }
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    entry.dispose?.();
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.dispose?.();
    this.entries.clear();
    this.bytes = 0;
  }
}
