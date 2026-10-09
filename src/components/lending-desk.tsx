import { CircleHelp } from "lucide-react";
import { LendingBoard } from "@/components/lending-board";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatUsdCompact } from "@/lib/market/format";
import { LENDING_GLOSSARY, lendingGlossary } from "@/lib/market/lending-glossary";
import { lendingActionChips, lendingBoardRows, lendingChainShareParts } from "@/lib/market/lending-stocks";
import { lendingChainLogo } from "@/lib/market/lending-logos";
import {
  EXCLUDED_CEX_MARGIN_VENUES,
  formatLendingCapturedAt,
  formatLendingFractionPct,
  lendingBorrowEstimateUsd,
  lendingHeadline,
  lendingLtvExplainer,
  lendingStockBorrows,
  type LendingDeskModel,
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
        {share.main.map((chain) => {
          const logo = lendingChainLogo(chain.chainId);
          return (
            <span key={chain.chainId} className="inline-flex items-center gap-1.5">
              {logo ? (
                // Local chain mark. The letter circle covers chains without a file.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="" className="size-3.5 rounded-full" />
              ) : null}
              {chain.chainLabel} <span className="num text-foreground">{formatUsdCompact(chain.collateralUsd)}</span>
            </span>
          );
        })}
        {share.smallerUsd !== null ? (
          <span>
            Smaller pools <span className="num text-foreground">{formatUsdCompact(share.smallerUsd)}</span>
          </span>
        ) : null}
      </p>
    </div>
  );
}

export function LendingDesk({ model }: { model: LendingDeskModel }) {
  const captured = formatLendingCapturedAt(model.capturedAt);
  const headline = lendingHeadline(model.rows, model.totals);
  const shorts = lendingStockBorrows(model.rows);
  const ltvLine = lendingLtvExplainer(model.rows);
  const action = lendingActionChips(model.rows);
  const boardRows = lendingBoardRows(model.rows);
  const collateralHint = lendingGlossary("collateral");
  const borrowedHint = lendingGlossary("stablecoin");
  const fullHint = lendingGlossary("utilization");
  const costHint = lendingGlossary("apy");
  const ltvHint = lendingGlossary("ltv");
  const liquidationHint = lendingGlossary("liquidation");
  const borrowedIncludesEstimate = (lendingBorrowEstimateUsd(model.rows) ?? 0) > 0;
  return (
    <div className="space-y-10" data-lending-page>
      <header className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-xl space-y-2">
          <h2 className="font-heading text-3xl font-semibold tracking-tight text-foreground">Lending</h2>
          <p className="text-sm leading-6 text-muted-foreground">People lock stock tokens and borrow dollar coins against them.</p>
          <p className="text-sm leading-6 text-muted-foreground" data-lending-captured>
            {model.readError
              ? model.readError
              : model.capturedAt
                ? `Snapshot at ${captured}. A dash means the source did not report that number.`
                : "No lending snapshot yet."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:gap-x-14">
          <div data-lending-stat="collateral">
            <p className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
              Stock in <Hint label={collateralHint.term} text={collateralHint.text} />
            </p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-foreground tabular-nums sm:text-4xl">{formatUsdCompact(model.totals.collateralUsd)}</p>
            <p className="mt-1 max-w-[12rem] text-sm leading-6 text-muted-foreground">Locked so people can borrow against it.</p>
          </div>
          <div data-lending-stat="borrowed">
            <p className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
              Dollars borrowed <Hint label={borrowedHint.term} text={borrowedHint.text} />
            </p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-foreground tabular-nums sm:text-4xl">{formatUsdCompact(model.totals.stableBorrowedUsd)}</p>
            <p className="mt-1 max-w-[12rem] text-sm leading-6 text-muted-foreground">
              {borrowedIncludesEstimate ? "Includes a Venus estimate." : "Dollar coins borrowed against that stock."}
            </p>
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm leading-6 text-muted-foreground">
        <p data-lending-stat="full" className="inline-flex items-center gap-1">
          How full <Hint label={fullHint.term} text={fullHint.text} />
          <span className="num text-foreground">{formatLendingFractionPct(model.totals.utilization)}</span>
        </p>
        <p data-lending-stat="cost" className="inline-flex items-center gap-1">
          Yearly cost <Hint label={costHint.term} text={costHint.text} />
          <span className="num text-foreground">{model.totals.borrowApy === null ? "—" : formatLendingFractionPct(model.totals.borrowApy)}</span>
        </p>
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">Learn more</summary>
          <div className="mt-2 max-w-xl space-y-1">
            <p>{headline.collateralSentence}</p>
            <p>{headline.borrowedSentence}</p>
            <p>{headline.fullSentence}</p>
            <p>{headline.costSentence}</p>
          </div>
        </details>
      </div>

      <ChainShare chains={model.chains} />

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
  );
}
