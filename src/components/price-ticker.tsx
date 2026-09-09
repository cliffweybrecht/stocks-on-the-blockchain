import Link from "next/link";
import { formatPrice } from "@/lib/market/format";
import type { EquityPriceTickerItem } from "@/lib/desk/price-ticker";

export function PriceTicker({ items }: { items: readonly EquityPriceTickerItem[] }) {
  if (items.length === 0) return null;
  const unit = items.length === 1 ? [items[0]!, items[0]!, items[0]!, items[0]!] : [...items];
  const loop = [...unit, ...unit];
  const durationSec = Math.max(24, unit.length * 5);

  return (
    <div className="border-b border-white/6 bg-background" aria-label="Equity prices for names with at least $1M 24h on-chain volume">
      <div className="price-ticker-fade mx-auto w-full max-w-6xl overflow-hidden px-4">
        <div
          className="price-ticker-track flex w-max items-center gap-8 py-1.5"
          style={{ animationDuration: `${durationSec}s` }}
        >
          {loop.map((item, index) => (
            <Link
              key={`${item.contractAddress}-${index}`}
              href={item.href}
              className="flex shrink-0 items-baseline gap-2 text-xs hover:text-foreground"
            >
              <span className="font-medium text-white">{item.symbol}</span>
              <span className="num text-neutral-400">{formatPrice(item.priceUsd)}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
