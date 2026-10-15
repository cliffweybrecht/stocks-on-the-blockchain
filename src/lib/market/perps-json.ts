import { PERPS_CSV_FILES, buildPerpsDailyCsv, buildPerpsTickerCsv, buildPerpsVenueCsv } from "./perps-csv";
import type { PerpsDeskModel } from "./perps-snapshot";

/**
 * JSON downloads that mirror the CSV files. The row objects use the same
 * columns. Empty CSV cells become null.
 */

export const PERPS_JSON_SCHEMA = "equity-perps-api-v1";

export const PERPS_JSON_ATTRIBUTION =
  "Compiled by Stocks on the Blockchain from public venue APIs and CoinGecko. These are synthetic equity perpetual futures, not tokenized-stock spot, and they are not added to spot or chain volume. Binance and Bybit headlines are CoinGecko rolling 24h because those exchange hosts block this environment. A blank value was not reported. Cite the snapshot date and the methodology.";

export const PERPS_JSON_FILES = [
  {
    id: "daily",
    href: "/perps/downloads/daily.json",
    filename: "perps-daily.json",
    label: "Daily history JSON",
  },
  {
    id: "venues",
    href: "/perps/downloads/venues.json",
    filename: "perps-venues.json",
    label: "Per venue JSON",
  },
  {
    id: "tickers",
    href: "/perps/downloads/tickers.json",
    filename: "perps-tickers.json",
    label: "Per ticker JSON",
  },
] as const;

export type PerpsJsonId = (typeof PERPS_JSON_FILES)[number]["id"];

function csvRecords(csv: string): Record<string, string | number | boolean | null>[] {
  const lines = csv.trim().split("\n");
  const headers = lines[0]?.split(",") ?? [];
  return lines.slice(1).filter((line) => line.length > 0).map((line) => {
    const cells = splitCsv(line);
    const row: Record<string, string | number | boolean | null> = {};
    headers.forEach((header, index) => {
      const cell = cells[index] ?? "";
      if (cell === "") row[header] = null;
      else if (cell === "true" || cell === "false") row[header] = cell === "true";
      else if (/^-?\d+(\.\d+)?$/.test(cell)) row[header] = Number(cell);
      else row[header] = cell;
    });
    return row;
  });
}

function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(current);
      current = "";
    } else current += char;
  }
  cells.push(current);
  return cells;
}

export function buildPerpsJson(id: PerpsJsonId, model: PerpsDeskModel, generatedAt: string): string {
  const file = PERPS_JSON_FILES.find((row) => row.id === id);
  const csv =
    id === "daily" ? buildPerpsDailyCsv(model) : id === "venues" ? buildPerpsVenueCsv(model) : buildPerpsTickerCsv(model);
  const body = {
    schema: PERPS_JSON_SCHEMA,
    id,
    attribution: PERPS_JSON_ATTRIBUTION,
    methodology: "/perps/methodology",
    generatedAt,
    columns: (csv.trim().split("\n")[0] ?? "").split(","),
    csv: PERPS_CSV_FILES.find((row) => row.id === id)?.href ?? null,
    rows: csvRecords(csv),
    label: file?.label ?? id,
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}
