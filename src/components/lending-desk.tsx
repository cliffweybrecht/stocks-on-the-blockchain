import { CircleHelp } from "lucide-react";
import { LendingBoard } from "@/components/lending-board";
import { LendingGlancePanel } from "@/components/lending-glance";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatUsdCompact } from "@/lib/market/format";
import { LENDING_GLOSSARY, lendingGlossary } from "@/lib/market/lending-glossary";
import {
  buildLendingDepth,
  lendingDropScopes,
  lendingDropTable,
  lendingFillingFlags,
  lendingGlance,
  lendingPreviousRows,
  lendingRiskLine,
  lendingSimpleBadges,
  lendingStaleNotes,
} from "@/lib/market/lending-glance";
import { lendingActionChips, lendingBoardRows, lendingChainShareParts } from "@/lib/market/lending-stocks";
import { lendingChainLogo } from "@/lib/market/lending-logos";
import {
  EXCLUDED_CEX_MARGIN_VENUES,
  formatLendingApy,
  formatLendingCapturedAt,
  formatLendingFractionPct,
  lendingFullnessNote,
  lendingHistorySeries,
  lendingLtvExplainer,
  lendingStockBorrows,
  type LendingDaySnapshot,
  type LendingDeskModel,
  type LendingHistoryPoint,
} from "@/lib/market/lending-snapshot";

function Hint({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
        aria-label={`${label} definition`}
      >
        <CircleHelp className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

function ChainShare({ chains }: { chains: LendingDeskModel["chains"] }) {
  const share = lendingChainShareParts(chains.map((chain) => ({ chainId: chain.chainId, chainLabel: chain.chainLabel, collateralUsd: chain.totals.collateralUsd })));
  const total = share.main.reduce((sum, chain) => sum + chain.collateralUsd, 0) + (share.smallerUsd ?? 0);
  if (!(total > 0)) return null;
  return (
    <div className="space-y-2" data-lending-chain-share>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label="Stock deposited by chain">
        {share.main.map((chain, index) => (
          <div
            key={chain.chainId}
            className="h-full bg-foreground"
            style={{
              width: `${(chain.collateralUsd / total) * 100}%`,
              opacity: Math.max(0.45, 1 - index * 0.1),
            }}
            title={`${chain.chainLabel} ${formatUsdCompact(chain.collateralUsd)}`}
          />
        ))}
        {share.smallerUsd !== null ? (
          <div
            className="h-full bg-foreground/40"
            style={{ width: `${(share.smallerUsd / total) * 100}%` }}
            title={`Smaller pools ${formatUsdCompact(share.smallerUsd)}`}
          />
        ) : null}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-6 text-muted-foreground">
        {share.main.map((chain) => (
          <span key={chain.chainId} className="inline-flex items-center gap-1.5">
            <ChainMark chainId={chain.chainId} label={chain.chainLabel} />
            {chain.chainLabel} <span className="num text-foreground">{formatUsdCompact(chain.collateralUsd)}</span>
          </span>
        ))}
        {share.smallerUsd !== null ? (
          <span>
            Smaller pools <span className="num text-foreground">{formatUsdCompact(share.smallerUsd)}</span>
          </span>
        ) : null}
      </p>
    </div>
  );
}

function ChainMark({ chainId, label }: { chainId: string; label: string }) {
  const logo = lendingChainLogo(chainId);
  if (logo) {
    return (
      // Local chain mark. The letter circle covers chains without a file.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logo} alt="" className="size-3.5 rounded-full" />
    );
  }
  const letter = (label.replace(/[^A-Za-z0-9]/g, "")[0] ?? "?").toUpperCase();
  return (
    <span className="flex size-3.5 items-center justify-center rounded-full bg-muted text-[8px] font-medium text-foreground" aria-hidden>
      {letter}
    </span>
  );
}

function HistoryChart({ history }: { history: readonly LendingHistoryPoint[] }) {
  const series = lendingHistorySeries(history);
  if (series.kind === "empty") return null;
  if (series.kind === "single") {
    return (
      <section className="space-y-2" data-lending-history="single">
        <h3 className="text-sm font-medium text-muted-foreground">Over time</h3>
        <p className="text-sm leading-6 text-muted-foreground">
          One daily snapshot, {series.point.date}. The chart starts once a second day is stored. Earlier days are not filled in.
        </p>
      </section>
    );
  }
  const points = series.points;
  const width = 640;
  const height = 168;
  const padL = 52;
  const padR = 8;
  const padT = 12;
  const padB = 24;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const values = points.flatMap((point) => [point.collateralUsd, point.stableBorrowedUsd].filter((value): value is number => value !== null && value >= 0));
  const max = Math.max(1, ...values);
  const xAt = (index: number) => padL + (points.length === 1 ? innerW / 2 : (index / (points.length - 1)) * innerW);
  const yAt = (value: number) => padT + innerH - (value / max) * innerH;
  const line = (pick: (point: LendingHistoryPoint) => number | null) => {
    const commands: string[] = [];
    points.forEach((point, index) => {
      const value = pick(point);
      if (value === null) return;
      commands.push(`${commands.length === 0 ? "M" : "L"}${xAt(index).toFixed(1)} ${yAt(value).toFixed(1)}`);
    });
    return commands.length >= 2 ? commands.join(" ") : null;
  };
  const collateral = line((point) => point.collateralUsd);
  const borrowed = line((point) => point.stableBorrowedUsd);
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <section className="space-y-2" data-lending-history="line">
      <h3 className="text-sm font-medium text-muted-foreground">Over time</h3>
      <figure className="space-y-2">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full text-foreground" role="img" aria-label="Stock deposited and dollars borrowed by daily snapshot">
          <line x1={padL} y1={yAt(0)} x2={width - padR} y2={yAt(0)} stroke="currentColor" strokeOpacity="0.15" />
          <line x1={padL} y1={yAt(max)} x2={width - padR} y2={yAt(max)} stroke="currentColor" strokeOpacity="0.08" />
          <text x={padL - 8} y={yAt(max) + 4} textAnchor="end" fill="currentColor" opacity="0.6" fontSize="11">
            {formatUsdCompact(max)}
          </text>
          {collateral ? <path d={collateral} fill="none" stroke="currentColor" strokeWidth="2" /> : null}
          {borrowed ? <path d={borrowed} fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="2" /> : null}
          {points.map((point, index) => (
            <g key={point.date}>
              {point.collateralUsd !== null ? <circle cx={xAt(index)} cy={yAt(point.collateralUsd)} r="2.5" fill="currentColor" /> : null}
              {point.stableBorrowedUsd !== null ? <circle cx={xAt(index)} cy={yAt(point.stableBorrowedUsd)} r="2.5" fill="currentColor" opacity="0.4" /> : null}
            </g>
          ))}
          {first ? (
            <text x={xAt(0)} y={height - 6} textAnchor="start" fill="currentColor" opacity="0.6" fontSize="11">
              {first.date}
            </text>
          ) : null}
          {last && points.length > 1 ? (
            <text x={xAt(points.length - 1)} y={height - 6} textAnchor="end" fill="currentColor" opacity="0.6" fontSize="11">
              {last.date}
            </text>
          ) : null}
        </svg>
        <figcaption className="text-sm leading-6 text-muted-foreground">
          Daily snapshots from this desk. The solid line is stock deposited. The lighter line is dollars borrowed. Earlier days are not filled in from other sources.
        </figcaption>
      </figure>
      <ul className="sr-only">
        {points.map((point) => (
          <li key={point.date}>
            {point.date}: stock {formatUsdCompact(point.collateralUsd)}, borrowed {formatUsdCompact(point.stableBorrowedUsd)}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LendingDesk({ model, days }: { model: LendingDeskModel; days: readonly LendingDaySnapshot[] }) {
  const previous = lendingPreviousRows(days);
  const flags = lendingFillingFlags(model.rows, previous);
  const badges = lendingSimpleBadges(model.rows, previous);
  const staleNotes = lendingStaleNotes(model.rows);
  const glance = lendingGlance(model.rows, model.totals, flags);
  const scopes = lendingDropScopes(model.rows);
  const answers = lendingDropTable(model.rows, scopes);
  const depth = buildLendingDepth(days);
  const shorts = lendingStockBorrows(model.rows);
  const ltvLine = lendingLtvExplainer(model.rows);
  const action = lendingActionChips(model.rows);
  const boardRows = lendingBoardRows(model.rows);
  const collateralHint = lendingGlossary("collateral");
  const ltvHint = lendingGlossary("ltv");
  const liquidationHint = lendingGlossary("liquidation");
  const fullHint = lendingGlossary("utilization");
  const costHint = lendingGlossary("apy");
  return (
    <div className="space-y-10" data-lending-page>
      <LendingGlancePanel
        glance={glance}
        flags={flags}
        badges={badges}
        staleNotes={staleNotes}
        scopes={scopes}
        answers={answers}
        depth={depth}
        capturedLabel={model.capturedAt ? `Snapshot ${formatLendingCapturedAt(model.capturedAt)}` : null}
        totals={model.totals}
        fullnessNote={lendingFullnessNote(model.rows)}
        riskLine={lendingRiskLine(model.rows)}
        readError={model.readError}
      />

      <details data-lending-books>
        <summary className="cursor-pointer text-base font-medium text-foreground">See every stock, chain, and note</summary>
        <div className="mt-8 space-y-10">
      <p className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm leading-6 text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          How full <Hint label={fullHint.term} text={fullHint.text} />
          <span className="num text-foreground">{formatLendingFractionPct(model.totals.utilization)}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          Yearly cost <Hint label={costHint.term} text={costHint.text} />
          <span className="num text-foreground">{formatLendingApy(model.totals)}</span>
        </span>
      </p>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{lendingFullnessNote(model.rows)}</p>

      <ChainShare chains={model.chains} />

      <HistoryChart history={model.history} />

      {action.length > 0 ? (
        <section className="space-y-2" data-lending-action>
          <h3 className="text-sm font-medium text-muted-foreground">Where the action is</h3>
          <ul className="flex flex-wrap gap-2">
            {action.map((chip) => (
              <li key={chip.label} className="max-w-full rounded-full border border-border/80 px-3 py-1.5 text-sm leading-6">
                <span className="font-medium text-foreground">{chip.label}</span>
                <span className="text-muted-foreground"> {chip.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <details data-lending-how>
        <summary className="cursor-pointer text-base font-medium text-foreground">How it works</summary>
        <ol className="mt-3 max-w-2xl space-y-3 text-sm leading-6 text-muted-foreground">
          <li>
            <span className="text-foreground">Lock stock tokens.</span> They sit in a pool as{" "}
            <span className="whitespace-nowrap">
              collateral <Hint label={collateralHint.term} text={collateralHint.text} />
            </span>
            .
          </li>
          <li>
            <span className="text-foreground">Borrow dollar coins</span> such as USDC, USDG, or PYUSD, up to a limit. {ltvLine}{" "}
            <Hint label={ltvHint.term} text={ltvHint.text} />
          </li>
          <li>
            <span className="text-foreground">If the stock falls too far,</span> the loan can be{" "}
            <span className="whitespace-nowrap">
              liquidated <Hint label={liquidationHint.term} text={liquidationHint.text} />
            </span>
            . The stock is sold to repay the dollars.
          </li>
        </ol>
      </details>

      {boardRows.length > 0 ? (
        <LendingBoard rows={boardRows} />
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">No onchain lending snapshot is stored for this desk.</p>
      )}

      <section className="space-y-3" data-lending-watch>
        <h3 className="text-base font-medium text-foreground">What to watch</h3>
        <ul className="max-w-3xl space-y-3 text-sm leading-6 text-muted-foreground">
          <li>
            Stock price feeds take the weekend off. Chainlink’s stock prices run about 24 hours a day, 5 days a week. They go quiet from Friday 8:00 PM Eastern to Sunday 8:00 PM Eastern, about 60 hours. A price move over the weekend shows up all at once on Monday.
          </li>
          <li>Aave can pause a stock token when that company splits its shares. Borrowing against it waits until the token catches up to the new share count.</li>
          <li>Most of these tokens do not give you a vote or a dividend the way a real share does. Many of them are not offered to people in the United States.</li>
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

      <section className="space-y-3" data-lending-glossary>
        <h3 className="text-base font-medium text-foreground">Words on this page</h3>
        <dl className="grid gap-x-10 gap-y-4 sm:grid-cols-2">
          {LENDING_GLOSSARY.map((entry) => (
            <div key={entry.id}>
              <dt className="text-sm font-medium text-foreground">{entry.term}</dt>
              <dd className="mt-1 text-sm leading-6 text-muted-foreground">{entry.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="max-w-3xl space-y-2 text-sm leading-6 text-muted-foreground" data-lending-footnote>
        <p>
          Not tracked onchain: {EXCLUDED_CEX_MARGIN_VENUES.join(", ")} margin. Those exchanges let people borrow against stock tokens, but they do not publish how much is in use.
        </p>
        <p>Issuer market cap and fund size are not used here. The numbers above are stock tokens in lending pools and the dollars borrowed against them.</p>
        {model.failures.length > 0 ? <p>Missing: {model.failures.map((failure) => `${failure.source} (${failure.message})`).join("; ")}.</p> : null}
      </footer>
        </div>
      </details>
    </div>
  );
}
