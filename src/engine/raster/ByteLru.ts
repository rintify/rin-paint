/** Byte-budgeted LRU; oversized values are returned by callers without being retained. */
export class ByteLru<K, V> {
  private readonly values = new Map<K, {value:V;bytes:number}>();
  private bytes = 0;
  constructor(readonly capacity: number, private readonly dispose: (value: V) => void = () => {}) {
    if (!Number.isFinite(capacity) || capacity < 0) throw new Error('キャッシュ容量が不正です');
  }
  get byteLength(): number { return this.bytes; }
  get size(): number { return this.values.size; }
  get(key: K): V | undefined {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    this.values.delete(key); this.values.set(key,entry); return entry.value;
  }
  set(key: K, value: V, bytes: number): boolean {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('リソース容量が不正です');
    this.delete(key);
    if (bytes > this.capacity) return false;
    while (this.bytes + bytes > this.capacity) this.delete(this.values.keys().next().value!);
    this.values.set(key,{value,bytes}); this.bytes += bytes; return true;
  }
  delete(key: K): void {
    const entry = this.values.get(key);
    if (!entry) return;
    this.values.delete(key); this.bytes -= entry.bytes; this.dispose(entry.value);
  }
  clear(): void { for (const key of this.values.keys()) this.delete(key); }
}
