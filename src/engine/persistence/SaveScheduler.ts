export class SaveScheduler {
  private revision = 0;
  private persisted = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<void> | null = null;
  failed = false;

  constructor(
    private readonly persist: () => Promise<void>,
    private readonly debounceMs = 200,
    private readonly options: {
      onFailure?: () => void;
      ready?: () => boolean;
    } = {},
  ) {}

  get dirty(): boolean {
    return this.revision !== this.persisted;
  }

  get inflight(): Promise<void> | null {
    return this.pending;
  }

  schedule(): void {
    this.revision++;
    this.failed = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  markClean(): void {
    this.persisted = this.revision;
    this.failed = false;
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending) return this.pending;
    if (this.persisted === this.revision) return;
    if (this.options.ready && !this.options.ready()) return;
    this.pending = this.loop().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async loop(): Promise<void> {
    while (this.persisted !== this.revision) {
      if (this.options.ready && !this.options.ready()) return;
      const target = this.revision;
      try {
        await this.persist();
        this.persisted = target;
        this.failed = false;
      } catch {
        this.failed = true;
        this.options.onFailure?.();
        return;
      }
    }
  }
}
