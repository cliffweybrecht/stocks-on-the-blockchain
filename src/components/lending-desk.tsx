import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatUsdCompact } from "@/lib/market/format";
import {
  EXCLUDED_CEX_MARGIN_VENUES,
  formatLendingApy,
  formatLendingCapturedAt,
  formatLendingEstimateUsd,
  formatLendingFractionPct,
  formatLtvPerHundred,
  formatStockBorrowedNote,
  lendingHeadline,
  lendingLtvExplainer,
  lendingStockBorrows,
  type LendingAsset,
  type LendingDeskModel,
  type LendingHistoryPoint,
  type LendingRow,
} from "@/lib/market/lending-snapshot";

const HINTS = {
  collateral: "Collateral is the stock tokens a borrower locks up so they can borrow dollars.",
  ltv: "LTV means loan to value. It is the most you can borrow for each $100 of stock. A 70% LTV means $70.",
  utilization: "Utilization is how full a pool is. It is dollars already borrowed divided by dollars supplied to that pool.",
  apy: "APY means annual percentage yield. Here it is the yearly cost to borrow, before extra reward points.",
  liquidation: "Liquidation is a sale of the stock collateral when the price falls and the loan is too big for the limit.",
} as const;

function Hint({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 hover:text-muted-foreground"
        aria-label={label}
      >
        <CircleHelp className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

function Money({ value }: { value: number | null }) {
  return (
    <span className="num" data-missing={value === null ? "true" : undefined}>
      {formatUsdCompact(value)}
    </span>
  );
}

function sourceHost(source: string): string {
  try {
    return new URL(source).host.replace(/^www\./, "");
  } catch {
    return source || "snapshot";
  }
}

function fullTone(value: number): string {
  if (value >= 0.85) return "bg-price-down";
  if (value >= 0.6) return "bg-interpretive";
  return "bg-primary";
}

function fullWords(value: number): string {
  if (value >= 0.85) return "Very full";
  if (value >= 0.6) return "Filling up";
  return "Room left";
}

function FullMeter({ value, unavailable }: { value: number | null; unavailable?: boolean }) {
  if (unavailable) return <span className="text-muted-foreground">n/a</span>;
  if (value === null) return <span className="num text-muted-foreground">—</span>;
  const width = Math.max(0, Math.min(value, 1)) * 100;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="num">{formatLendingFractionPct(value)}</span>
        <span className="text-[10px] text-muted-foreground">{fullWords(value)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={`h-full rounded-full ${fullTone(value)}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function assetLine(asset: LendingAsset): string {
  const limit = asset.maxLtv === null ? null : `up to ${formatLtvPerHundred(asset.maxLtv)} per $100`;
  const size = asset.collateralUsd === null ? null : formatUsdCompact(asset.collateralUsd);
  return [asset.symbol, size, limit].filter(Boolean).join(" · ");
}

function TokenList({ assets }: { assets: LendingAsset[] }) {
  if (assets.length === 0) return <p className="text-xs text-muted-foreground">This snapshot does not list the stock tokens.</p>;
  const preview = assets.slice(0, 6);
  const rest = assets.slice(6);
  return (
    <div data-lending-assets>
      <p className="text-[10px] tracking-wide text-muted-foreground">Stock tokens accepted</p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {preview.map((asset) => (
          <li key={asset.address} className="rounded-full border border-border bg-background/50 px-2 py-1 text-[11px] leading-none">
            {assetLine(asset)}
          </li>
        ))}
      </ul>
      {rest.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">{rest.length} more stock tokens</summary>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {rest.map((asset) => (
              <li key={asset.address} className="rounded-full border border-border bg-background/50 px-2 py-1 text-[11px] leading-none">
                {assetLine(asset)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function BorrowedValue({ row }: { row: LendingRow }) {
  if (row.borrowEstimate && row.stableBorrowedUsd !== null) {
    return (
      <span className="num" data-lending-estimate>
        {formatLendingEstimateUsd(row.stableBorrowedUsd)} est. (pro-rata, shared pool)
      </span>
    );
  }
  return <Money value={row.stableBorrowedUsd} />;
}

function VenueCard({ row }: { row: LendingRow }) {
  const stockLent = formatStockBorrowedNote(row.stockBorrowedUsd);
  const shared = Boolean(row.borrowEstimate);
  return (
    <article data-lending-row={row.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card/80 p-3 sm:p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate font-heading text-base font-medium">{row.venue}</h4>
          <p className="text-[11px] text-muted-foreground">{row.chainLabel}</p>
        </div>
        <p className="shrink-0 text-right text-[10px] text-muted-foreground">
          <a href={row.source} className="underline-offset-2 hover:underline">
            {sourceHost(row.source)}
          </a>
        </p>
      </header>
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="flex items-center gap-1 text-[10px] tracking-wide text-muted-foreground">
            Stock in
            <Hint label="Collateral definition" text={HINTS.collateral} />
          </dt>
          <dd className="num mt-1 text-lg text-primary">
            <Money value={row.collateralUsd} />
          </dd>
        </div>
        <div>
          <dt className="text-[10px] tracking-wide text-muted-foreground">Dollars borrowed</dt>
          <dd className="mt-1 text-sm leading-snug">
            <BorrowedValue row={row} />
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-[10px] tracking-wide text-muted-foreground">
            How full
            <Hint label="Utilization definition" text={HINTS.utilization} />
          </dt>
          <dd className="mt-1">
            <FullMeter value={row.utilization} unavailable={shared} />
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-[10px] tracking-wide text-muted-foreground">
            Yearly cost
            <Hint label="APY definition" text={HINTS.apy} />
          </dt>
          <dd className="num mt-1 text-sm">{shared ? <span className="text-muted-foreground">n/a</span> : formatLendingApy(row)}</dd>
        </div>
      </dl>
      {stockLent ? <p className="text-[11px] text-muted-foreground" data-lending-stock-borrowed>{stockLent}</p> : null}
      {row.note ? <p className="text-[11px] leading-snug text-muted-foreground">{row.note}</p> : null}
      {row.error ? <p className="text-[11px] leading-snug text-destructive">{row.error}</p> : null}
      <TokenList assets={row.assets ?? []} />
    </article>
  );
}

function Trend({ history }: { history: LendingHistoryPoint[] }) {
  if (history.length === 0) return null;
  if (history.length < 2) {
    const point = history[0];
    return (
      <section className="rounded-xl border border-border bg-card/40 px-4 py-3" data-lending-trend="single">
        <h3 className="font-heading text-lg font-medium">Over time</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          One daily snapshot so far ({point ? formatLendingCapturedAt(point.capturedAt) : "—"}). Stock in{" "}
          {point ? formatUsdCompact(point.collateralUsd) : "—"}, dollars borrowed{" "}
          {point ? formatUsdCompact(point.stableBorrowedUsd) : "—"}. A line will show up after the next day is saved.
        </p>
      </section>
    );
  }
  const width = 640;
  const height = 160;
  const pad = { left: 8, right: 8, top: 12, bottom: 22 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(
    ...history.map((point) => point.collateralUsd ?? 0),
    ...history.map((point) => point.stableBorrowedUsd ?? 0),
    1,
  );
  const xAt = (index: number) => pad.left + (history.length === 1 ? innerW / 2 : (index / (history.length - 1)) * innerW);
  const yAt = (value: number | null) => pad.top + innerH - ((value ?? 0) / max) * innerH;
  const line = (key: "collateralUsd" | "stableBorrowedUsd") =>
    history
      .map((point, index) => `${index === 0 ? "M" : "L"} ${xAt(index).toFixed(1)} ${yAt(point[key]).toFixed(1)}`)
      .join(" ");
  return (
    <section className="rounded-xl border border-border bg-card/40 px-4 py-3" data-lending-trend="series">
      <h3 className="font-heading text-lg font-medium">Over time</h3>
      <p className="mt-1 text-xs text-muted-foreground">Each point is one Eastern-time day from the snapshot files.</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-40 w-full" role="img" aria-label="Stock collateral and dollars borrowed over time">
        <path d={line("collateralUsd")} fill="none" stroke="var(--primary)" strokeWidth="2.5" />
        <path d={line("stableBorrowedUsd")} fill="none" stroke="var(--interpretive)" strokeWidth="2.5" />
        {history.map((point, index) => (
          <text key={point.date} x={xAt(index)} y={height - 4} textAnchor="middle" className="fill-muted-foreground" fontSize="11">
            {point.date.slice(5)}
          </text>
        ))}
      </svg>
      <p className="mt-1 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
        <span><span className="mr-1 inline-block size-2 rounded-full bg-primary" /> Stock in</span>
        <span><span className="mr-1 inline-block size-2 rounded-full bg-interpretive" /> Dollars borrowed</span>
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  sentence,
  hint,
  emphasize = false,
  testId,
}: {
  label: string;
  value: string;
  sentence: string;
  hint?: { label: string; text: string };
  emphasize?: boolean;
  testId: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/80 px-3 py-3 sm:px-4" data-lending-stat={testId}>
      <p className="flex items-center gap-1 text-[10px] tracking-wide text-muted-foreground">
        {label}
        {hint ? <Hint label={hint.label} text={hint.text} /> : null}
      </p>
      <p className={`num mt-1 text-2xl sm:text-3xl ${emphasize ? "text-primary" : ""}`}>{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{sentence}</p>
    </div>
  );
}

export function LendingDesk({ model }: { model: LendingDeskModel }) {
  const captured = formatLendingCapturedAt(model.capturedAt);
  const headline = lendingHeadline(model.rows, model.totals);
  const shorts = lendingStockBorrows(model.rows);
  const ltvLine = lendingLtvExplainer(model.rows);
  const hasRows = model.chains.length > 0;
  return (
    <div className="space-y-8" data-lending-page>
      <header className="space-y-2">
        <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Borrowing against stock tokens</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          People lock tokenized stocks and borrow dollar coins against them. This page shows how much stock is locked, how many dollars are borrowed, and what can go wrong.
        </p>
        <p className="text-xs text-muted-foreground" data-lending-captured>
          {model.readError
            ? model.readError
            : model.capturedAt
              ? `All figures are from the snapshot at ${captured}. A dash means the source did not report that number.`
              : "No lending snapshot yet."}
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          testId="collateral"
          label="Stock in"
          emphasize
          hint={{ label: "Collateral definition", text: HINTS.collateral }}
          value={formatUsdCompact(model.totals.collateralUsd)}
          sentence={headline.collateralSentence}
        />
        <Stat
          testId="borrowed"
          label="Dollars borrowed"
          value={formatUsdCompact(model.totals.stableBorrowedUsd)}
          sentence={headline.borrowedSentence}
        />
        <Stat
          testId="full"
          label="How full"
          hint={{ label: "Utilization definition", text: HINTS.utilization }}
          value={formatLendingFractionPct(model.totals.utilization)}
          sentence={headline.fullSentence}
        />
        <Stat
          testId="cost"
          label="Yearly cost"
          hint={{ label: "APY definition", text: HINTS.apy }}
          value={model.totals.borrowApy === null ? "—" : formatLendingFractionPct(model.totals.borrowApy)}
          sentence={headline.costSentence}
        />
      </section>

      <section className="rounded-xl border border-border bg-card/40 px-4 py-4" data-lending-how>
        <h3 className="font-heading text-lg font-medium">How it works</h3>
        <ol className="mt-3 grid gap-4 sm:grid-cols-3">
          <li>
            <p className="text-[10px] tracking-wide text-muted-foreground">1</p>
            <p className="mt-1 text-sm leading-relaxed">
              Deposit a stock token. That stock is the <span className="whitespace-nowrap">collateral <Hint label="Collateral definition" text={HINTS.collateral} /></span>.
            </p>
          </li>
          <li>
            <p className="text-[10px] tracking-wide text-muted-foreground">2</p>
            <p className="mt-1 text-sm leading-relaxed">
              Borrow stablecoins such as USDC, USDG, or PYUSD, up to a limit. {ltvLine}{" "}
              <Hint label="LTV definition" text={HINTS.ltv} />
            </p>
          </li>
          <li>
            <p className="text-[10px] tracking-wide text-muted-foreground">3</p>
            <p className="mt-1 text-sm leading-relaxed">
              If the stock price falls too far, the loan can be <span className="whitespace-nowrap">liquidated <Hint label="Liquidation definition" text={HINTS.liquidation} /></span>. The stock is sold to repay the dollars.
            </p>
          </li>
        </ol>
      </section>

      <Trend history={model.history} />

      {hasRows ? (
        <div className="space-y-8">
          {model.chains.map((chain) => {
            const estimated = chain.rows.some((row) => row.borrowEstimate);
            return (
              <section key={chain.chainId} data-lending-chain={chain.chainId} className="space-y-3">
                <header className="flex flex-wrap items-end justify-between gap-2">
                  <h3 className="font-heading text-lg font-medium">{chain.chainLabel}</h3>
                  <p className="text-xs text-muted-foreground">
                    Stock in {formatUsdCompact(chain.totals.collateralUsd)}
                    {" · "}
                    Borrowed {formatUsdCompact(chain.totals.stableBorrowedUsd)}
                    {estimated ? " (includes an estimate)" : ""}
                  </p>
                </header>
                <div className="grid gap-3 lg:grid-cols-2">
                  {chain.rows.map((row) => (
                    <VenueCard key={row.id} row={row} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <p className="rounded-xl border border-border bg-card/80 px-4 py-8 text-center text-sm text-muted-foreground">
          No onchain lending snapshot is stored for this desk.
        </p>
      )}

      <section className="space-y-3" data-lending-watch>
        <h3 className="font-heading text-lg font-medium">What to watch</h3>
        <ul className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <li>
            Stock price feeds take the weekend off. Chainlink’s stock prices run about 24 hours a day, 5 days a week. They go quiet from Friday 8:00 PM Eastern to Sunday 8:00 PM Eastern, about 60 hours. A price move over the weekend shows up all at once on Monday.
          </li>
          <li>
            Aave can pause a stock token when that company splits its shares. Borrowing against it waits until the token catches up to the new share count.
          </li>
          <li>
            Most of these tokens do not give you a vote or a dividend the way a real share does. Many of them are not offered to people in the United States.
          </li>
          <li>
            {shorts.length === 0
              ? "Almost nobody lends the stock token itself so someone else can bet the price will fall. This snapshot does not show any of those loans."
              : `Almost nobody lends the stock token itself so someone else can bet the price will fall. This snapshot shows ${shorts
                  .map((line) => `${line.venue} on ${line.chainLabel} (${formatUsdCompact(line.usd)})`)
                  .join("; ")}.`}
          </li>
          <li>
            On Solana, a points program called xPoints can pull extra stock deposits in. The dollars on this page still come from the venues. The snapshot does not split points from real borrowing.
          </li>
        </ul>
      </section>

      <footer className="space-y-2 text-[11px] leading-snug text-muted-foreground" data-lending-footnote>
        <p>
          Not tracked onchain: {EXCLUDED_CEX_MARGIN_VENUES.join(", ")} margin. Those exchanges let people borrow against stock tokens, but they do not publish how much is in use.
        </p>
        <p>Issuer market cap and fund size are not used here. The numbers above are stock tokens in lending pools and the dollars borrowed against them.</p>
        {model.failures.length > 0 ? (
          <p>Missing: {model.failures.map((failure) => `${failure.source} (${failure.message})`).join("; ")}.</p>
        ) : null}
      </footer>
    </div>
  );
}
