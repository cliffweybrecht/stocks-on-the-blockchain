import { DISPLAYED_LIQUIDITY_NOTE, PRICE_MARKS_NOTE, PRODUCT_DISCLAIMER } from "@/lib/market/trust";

export function TrustBanner() {
  return (
    <aside className="rounded-xl border border-interpretive/30 bg-interpretive/8 px-4 py-3 text-sm leading-relaxed">
      <p className="font-medium text-foreground">{PRODUCT_DISCLAIMER}</p>
      <p className="mt-2 text-muted-foreground">{DISPLAYED_LIQUIDITY_NOTE}</p>
      <p className="mt-1 text-muted-foreground">{PRICE_MARKS_NOTE}</p>
    </aside>
  );
}
