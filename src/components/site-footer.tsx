import { PRODUCT_DISCLAIMER } from "@/lib/market/trust";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/70">
      <div className="mx-auto max-w-6xl px-4 py-6 text-xs leading-relaxed text-muted-foreground">
        <p>{PRODUCT_DISCLAIMER}</p>
        <p className="mt-2">
          Missing values stay missing. A dash is “not reported,” not zero. Premium/discount is
          labeled interpretive because it is derived from two independently observed marks.
        </p>
      </div>
    </footer>
  );
}
