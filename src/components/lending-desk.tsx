import { formatUsdCompact } from "@/lib/market/format";
import {
  EXCLUDED_CEX_MARGIN_VENUES,
  formatLendingApy,
  formatLendingCapturedAt,
  formatLendingFractionPct,
  formatStockBorrowedNote,
  type LendingDeskModel,
  type LendingRow,
  type LendingTotals,
} from "@/lib/market/lending-snapshot";

function Money({ value, emphasize = false }: { value: number | null; emphasize?: boolean }) {
  return (
    <span className={`num ${emphasize ? "text-primary" : ""}`} data-missing={value === null ? "true" : undefined}>
      {formatUsdCompact(value)}
    </span>
  );
}

function MetricRow({
  row,
  totals = false,
}: {
  row: { venue: string; chainLabel: string; id?: string } & LendingTotals;
  totals?: boolean;
}) {
  const stockBorrowed = formatStockBorrowedNote(row.stockBorrowedUsd);
  return (
    <tr
      data-lending-row={row.id}
      data-lending-total={totals ? row.venue : undefined}
      className={totals ? "border-t border-border/80 bg-background/40" : "border-t border-border/40"}
    >
      <td className="px-3 py-2">
        <div className={`truncate ${totals ? "font-medium" : ""}`}>{row.venue}</div>
        {stockBorrowed ? (
          <p className="mt-0.5 text-[10px] text-muted-foreground" data-lending-stock-borrowed>
            {stockBorrowed}
          </p>
        ) : null}
      </td>
      <td className="px-3 py-2 text-muted-foreground">{totals ? "" : row.chainLabel}</td>
      <td className="px-3 py-2 text-right">
        <Money value={row.collateralUsd} emphasize />
      </td>
      <td className="px-3 py-2 text-right">
        <Money value={row.stableBorrowedUsd} />
      </td>
      <td className="num px-3 py-2 text-right">{formatLendingFractionPct(row.utilization)}</td>
      <td className="num px-3 py-2 text-right">{formatLendingApy(row)}</td>
    </tr>
  );
}

function totalsAsRow(label: string, chainLabel: string, totals: LendingTotals, id: string) {
  return {
    id,
    venue: label,
    chainLabel,
    ...totals,
  };
}

export function LendingDesk({ model }: { model: LendingDeskModel }) {
  const captured = formatLendingCapturedAt(model.capturedAt);
  return (
    <div className="space-y-4" data-lending-page>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">Lending</h2>
          <p className="mt-1 text-xs text-muted-foreground" data-lending-captured>
            {model.readError ? model.readError : model.capturedAt ? `Snapshot ${captured}` : "No lending snapshot yet."}
          </p>
        </div>
        <div className="flex gap-6">
          <div>
            <p className="text-[10px] tracking-wide text-muted-foreground">Stock collateral</p>
            <p className="num text-2xl text-primary sm:text-3xl" data-lending-collateral>
              {formatUsdCompact(model.totals.collateralUsd)}
            </p>
          </div>
          <div>
            <p className="text-[10px] tracking-wide text-muted-foreground">Stablecoins borrowed</p>
            <p className="num text-2xl sm:text-3xl" data-lending-borrowed>
              {formatUsdCompact(model.totals.stableBorrowedUsd)}
            </p>
          </div>
        </div>
      </header>

      <div className="overflow-x-auto rounded-xl border border-border bg-card/80">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead>
            <tr className="text-[10px] tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Venue</th>
              <th className="px-3 py-2 font-medium">Chain</th>
              <th className="px-3 py-2 text-right font-medium">Stock collateral</th>
              <th className="px-3 py-2 text-right font-medium">Stablecoins borrowed</th>
              <th className="px-3 py-2 text-right font-medium">Utilization</th>
              <th className="px-3 py-2 text-right font-medium">Borrow APY</th>
            </tr>
          </thead>
          <tbody>
            {model.chains.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No onchain lending snapshot is stored for this desk.
                </td>
              </tr>
            ) : (
              model.chains.map((chain) => (
                <ChainBlock key={chain.chainId} chainId={chain.chainId} rows={chain.rows} label={chain.chainLabel} totals={chain.totals} />
              ))
            )}
            {model.chains.length > 0 ? (
              <MetricRow
                totals
                row={totalsAsRow("Total", "", model.totals, "overall")}
              />
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground" data-lending-footnote>
        Excluded CEX margin: {EXCLUDED_CEX_MARGIN_VENUES.join(", ")}. None of them publish usage.
        {model.failures.length > 0
          ? ` Missing: ${model.failures.map((failure) => `${failure.source} (${failure.message})`).join("; ")}.`
          : ""}
      </p>
    </div>
  );
}

function ChainBlock({
  chainId,
  label,
  rows,
  totals,
}: {
  chainId: string;
  label: string;
  rows: LendingRow[];
  totals: LendingTotals;
}) {
  return (
    <>
      {rows.map((row) => (
        <MetricRow key={row.id} row={row} />
      ))}
      <MetricRow totals row={totalsAsRow(`${label} total`, label, totals, chainId)} />
    </>
  );
}
