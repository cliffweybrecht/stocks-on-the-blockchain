/**
 * Remember DexScreener preview outcomes across snapshot refreshes so a 5-minute
 * cache rebuild does not spend the hydrate budget re-checking mints that already
 * returned zero indexed pools.
 */
export class SolanaHydrateMemory {
  private readonly emptyAt = new Map<string, number>();
  private readonly pooled = new Set<string>();

  constructor(private readonly emptyTtlMs: number) {}

  markPooled(mints: Iterable<string>, now = Date.now()): void {
    for (const mint of mints) {
      this.pooled.add(mint);
      this.emptyAt.delete(mint);
    }
    void now;
  }

  markEmpty(mints: Iterable<string>, now = Date.now()): void {
    for (const mint of mints) {
      if (this.pooled.has(mint)) continue;
      this.emptyAt.set(mint, now);
    }
  }

  isConfirmedEmpty(mint: string, now = Date.now()): boolean {
    const checkedAt = this.emptyAt.get(mint);
    if (checkedAt == null) return false;
    if (now - checkedAt > this.emptyTtlMs) {
      this.emptyAt.delete(mint);
      return false;
    }
    return true;
  }

  pooledMints(): ReadonlySet<string> {
    return this.pooled;
  }

  rememberOutcome(
    requested: readonly string[],
    found: ReadonlySet<string>,
    failed: ReadonlySet<string>,
    incomplete: ReadonlySet<string>,
    now = Date.now(),
  ): void {
    const empty: string[] = [];
    const pooled: string[] = [];
    for (const mint of requested) {
      if (found.has(mint)) pooled.push(mint);
      else if (!failed.has(mint) && !incomplete.has(mint)) empty.push(mint);
    }
    if (pooled.length > 0) this.markPooled(pooled, now);
    if (empty.length > 0) this.markEmpty(empty, now);
  }
}
