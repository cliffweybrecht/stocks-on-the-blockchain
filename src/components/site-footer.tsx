import { FOOTER_DISCLAIMER, PREMIUM_DISCOUNT_FOOTER_NOTE } from "@/lib/market/trust";

export function SiteFooter({ showPremiumDiscount = false }: { showPremiumDiscount?: boolean }) {
  return (
    <footer className="mt-auto border-t border-border/70">
      <div className="mx-auto max-w-6xl px-4 py-6 text-xs leading-relaxed text-muted-foreground">
        <p>{FOOTER_DISCLAIMER}</p>
        {showPremiumDiscount ? <p className="mt-2">{PREMIUM_DISCOUNT_FOOTER_NOTE}</p> : null}
      </div>
    </footer>
  );
}
