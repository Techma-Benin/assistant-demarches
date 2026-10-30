export type Clock = () => number;

/** Table clé/valeur avec expiration paresseuse (pas de minuterie : ne retient pas le processus). */
export class TtlMap<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(private readonly now: Clock = Date.now) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    this.sweep();
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  private sweep(): void {
    if (this.entries.size < 1000) return;
    const t = this.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= t) this.entries.delete(key);
  }
}
