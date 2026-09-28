import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { AssetLogo } from "@/components/asset-logo";
import { AssetPin } from "@/components/asset-pin";
import { CopyAddress } from "@/components/copy-address";
import { Badge } from "@/components/ui/badge";
import { assetIdentityMetaParts, BREADCRUMB_CURRENT_CLASS, dexScreenerTokenUrl, sourceRowLabel } from "@/lib/desk/asset-identity";
import type { AssetDetail, ChainVolume } from "@/lib/market/types";

export { BREADCRUMB_CURRENT_CLASS };

export function AssetBreadcrumb({
  chain,
  symbol,
}: {
  chain: Pick<ChainVolume, "id" | "name">;
  symbol: string;
}) {
  return (
    <nav className="text-sm text-muted-foreground" data-asset-breadcrumb>
      <Link href="/" className="hover:text-foreground">
        Chains
      </Link>
      <span className="px-2">/</span>
      <Link href={`/chains/${chain.id}`} className="hover:text-foreground">
        {chain.name}
      </Link>
      <span className="px-2">/</span>
      <span className={BREADCRUMB_CURRENT_CLASS} data-breadcrumb-current>
        {symbol}
      </span>
    </nav>
  );
}

export function AssetIdentityHeader({
  chain,
  asset,
  showPin = false,
  showBreadcrumb = true,
  description,
}: {
  chain: Pick<ChainVolume, "id" | "name">;
  asset: AssetDetail;
  showPin?: boolean;
  showBreadcrumb?: boolean;
  /** Rendered only when a source already supplied a real blurb. Never fabricated. */
  description?: string | null;
}) {
  const halt = asset.price.isTradingHalt;
  const meta = assetIdentityMetaParts(asset);
  const screenerUrl =
    asset.sourceId === "solana" ? dexScreenerTokenUrl(chain.id, asset.contractAddress) : null;
  const sourceBadge = asset.sourceId === "solana" ? null : sourceRowLabel(asset.sourceId);
  const blurb = description?.trim() || null;

  return (
    <header className="space-y-4">
      {showBreadcrumb ? <AssetBreadcrumb chain={chain} symbol={asset.symbol} /> : null}

      <div className="flex items-start gap-3 sm:gap-4">
        <AssetLogo logoUrl={asset.logoUrl} name={asset.name} symbol={asset.symbol} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">{asset.name}</h2>
            {showPin ? <AssetPin mint={asset.contractAddress} label={asset.symbol} /> : null}
            {asset.issuer ? (
              <Badge variant="outline" className="border-border/80 text-muted-foreground">
                {asset.issuer}
              </Badge>
            ) : null}
          </div>

          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{meta.symbol}</span>
            <CopyAddress address={asset.contractAddress} variant="inline" showAddress={false} />
            {screenerUrl ? (
              <a
                href={screenerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                DexScreener
                <ExternalLink className="size-3" />
              </a>
            ) : null}
          </p>

          {blurb ? <p className="max-w-2xl text-sm text-muted-foreground">{blurb}</p> : null}

          {sourceBadge || halt || asset.instrumentKind !== "equity" ? (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {sourceBadge ? (
                <Badge variant="outline" className="text-muted-foreground">
                  {sourceBadge}
                </Badge>
              ) : null}
              {halt ? <Badge variant="destructive">Trading halt reported</Badge> : null}
              {asset.instrumentKind !== "equity" ? (
                <span className="text-xs text-muted-foreground">
                  {asset.instrumentKind === "etf" ? "ETF / index" : "Private market"}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
