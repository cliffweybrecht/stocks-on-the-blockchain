import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { PriceChangeText } from "@/components/asset-price-chart";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCount, formatTokenAmount, formatUsdCompact } from "@/lib/market/format";
import { BASE_CHAIN_ID, ROBINHOOD_CHAIN_ID, type AssetDetail } from "@/lib/market/types";

const STATS: readonly {
  key: string;
  label: string;
  hint: string;
  robinhoodHint: string;
  value: (asset: AssetDetail) => ReactNode;
}[] = [
  {
    key: "marketCap",
    label: "Market Cap",
    hint: "DEX median price × circulating supply. Supply is the Solana mint's getTokenSupply UI amount. Blank when supply or price is missing — a pool's reported market cap is not used.",
    robinhoodHint:
      "Blank until a reported circulating supply and a DEX price both exist. GeckoTerminal market cap and a pool's reported market cap are not copied in.",
    value: (asset) => formatUsdCompact(asset.marketCapUsd),
  },
  {
    key: "liquidity",
    label: "Liquidity",
    hint: "Provider-reported displayed liquidity. Not executable depth.",
    robinhoodHint: "Sum of DexScreener displayed liquidity on Robinhood Chain (4663). Not executable depth.",
    value: (asset) => formatUsdCompact(asset.displayedLiquidityUsd),
  },
  {
    key: "volume",
    label: "24h Volume",
    hint: "Sum of DexScreener pair volume.h24 for this mint, when reported.",
    robinhoodHint: "Sum of DexScreener pair volume.h24 on Robinhood Chain (4663). A missing figure stays missing.",
    value: (asset) => formatUsdCompact(asset.volume24hUsd),
  },
  {
    key: "circulating",
    label: "Circulating Supply",
    hint: "Outstanding tokens from Solana getTokenSupply (UI amount, including Token-2022 scaled UI). Same figure as total supply: an SPL mint has no separate unminted cap, and this desk has no lockup feed. Never inferred from market cap, price, or liquidity.",
    robinhoodHint:
      "Absent unless a source reports circulating supply separately. Not inferred from market cap, FDV, or total supply.",
    value: (asset) => formatTokenAmount(asset.circulatingSupply),
  },
  {
    key: "holders",
    label: "Holder(s)",
    hint: "Jupiter Tokens V2 holderCount for this mint. Not a 24h figure. Missing stays a dash.",
    robinhoodHint: "GeckoTerminal holder count for this contract. Not a 24h figure. Missing stays a dash.",
    value: (asset) => formatCount(asset.holderCount),
  },
  {
    key: "change",
    label: "24h Change",
    hint: "DexScreener priceChange.h24 from the highest-volume pair that reported it.",
    robinhoodHint: "DexScreener priceChange.h24 from the highest-volume Robinhood Chain pair that reported it.",
    value: (asset) => <PriceChangeText value={asset.priceChange24hPct} />,
  },
  {
    key: "fdv",
    label: "FDV",
    hint: "DEX median price × total supply. Blank when supply or price is missing.",
    robinhoodHint:
      "DEX price × GeckoTerminal normalized total supply. Blank when either is missing. A pool's reported FDV is not used.",
    value: (asset) => formatUsdCompact(asset.fdvUsd),
  },
  {
    key: "total",
    label: "Total Supply",
    hint: "Outstanding tokens from Solana getTokenSupply (UI amount, including Token-2022 scaled UI). Never inferred from FDV, price, or liquidity.",
    robinhoodHint: "GeckoTerminal normalized total supply. Never inferred from FDV, price, or liquidity.",
    value: (asset) => formatTokenAmount(asset.totalSupply),
  },
];

function statHint(stat: (typeof STATS)[number], asset: AssetDetail): string {
  if (asset.chainId === BASE_CHAIN_ID || asset.sourceId === "base") {
    return stat.robinhoodHint
      .replaceAll("Robinhood Chain (4663)", "Base (8453)")
      .replaceAll("Robinhood Chain pair", "Base pair");
  }
  return asset.chainId === ROBINHOOD_CHAIN_ID || asset.sourceId === "robinhood" ? stat.robinhoodHint : stat.hint;
}

function StatHint({ label, hint }: { label: string; hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground/70 hover:text-muted-foreground"
        aria-label={`${label} definition`}
      >
        <CircleHelp className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

export function AssetStatsCard({ asset }: { asset: AssetDetail }) {
  return (
    <section className="rounded-xl border border-border bg-card/80 px-4 py-4 sm:px-5">
      <h3 className="font-heading text-lg font-medium">Statistics</h3>
      <div className="mt-3 grid grid-cols-2 gap-x-6 border-t border-border lg:grid-cols-4 lg:gap-x-8">
        {STATS.map((stat) => (
          <div key={stat.key} data-stat={stat.key} className="border-b border-border py-4">
            <div className="flex items-center gap-1.5">
              <p className="text-xs tracking-wide text-muted-foreground">{stat.label}</p>
              <StatHint label={stat.label} hint={statHint(stat, asset)} />
            </div>
            <p className="num mt-2 text-xl font-medium tracking-tight">{stat.value(asset)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
