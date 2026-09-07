"use client";

import { buttonVariants } from "@/components/ui/button";
import { buildDeskCsv, deskCsvFilename, type DeskCsvAsset } from "@/lib/desk/desk-csv";
import type { AssetSortKey } from "@/lib/market/aggregate";
import type { InstrumentKind } from "@/lib/market/types";
import type { CoverageFilter } from "@/lib/market/volume-coverage";

export function DeskCsvButton({
  rows,
  lane,
  coverage,
  sortKey,
}: {
  rows: readonly DeskCsvAsset[];
  lane: InstrumentKind;
  coverage: CoverageFilter;
  sortKey: AssetSortKey;
}) {
  function onExport() {
    const csv = buildDeskCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = deskCsvFilename({ lane, coverage, sortKey, at: new Date() });
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      data-testid="solana-csv-export"
      className={buttonVariants({ variant: "outline", size: "sm" })}
      onClick={onExport}
      disabled={rows.length === 0}
    >
      Export CSV
    </button>
  );
}
