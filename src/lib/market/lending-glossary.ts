export interface LendingGlossaryEntry {
  id: string;
  term: string;
  text: string;
}

/**
 * The only definition of how full.
 * The page, the headline, and snapshot checks all use this sentence.
 */
export const LENDING_FULLNESS_TEXT =
  "How full a pool is. It is the dollars already borrowed, divided by the dollars people supplied to lend. The desk total counts only pools that publish their own lend supply. Locked stock is not the bottom number.";

/** Kid-simple definitions. Tooltips and the bottom glossary use the same sentences. */
export const LENDING_GLOSSARY: readonly LendingGlossaryEntry[] = [
  {
    id: "collateral",
    term: "Collateral",
    text: "Collateral is the stock token you lock up so you can borrow dollars.",
  },
  {
    id: "stablecoin",
    term: "Stablecoin",
    text: "A stablecoin is a coin that tries to stay worth one dollar, such as USDC or USDG.",
  },
  {
    id: "ltv",
    term: "LTV",
    text: "LTV means loan to value. It is the most you can borrow for each $100 of stock. A 70% LTV means $70.",
  },
  {
    id: "liquidation",
    term: "Liquidation",
    text: "Liquidation is when the locked stock gets sold because the price fell and the loan is too big.",
  },
  {
    id: "utilization",
    term: "How full",
    text: LENDING_FULLNESS_TEXT,
  },
  {
    id: "apy",
    term: "Yearly cost",
    text: "Yearly cost is the APY, or annual percentage yield. It is what a borrower pays in a year, before extra reward points.",
  },
  {
    id: "oracle",
    term: "Oracle",
    text: "An oracle is the price feed. It tells the pool what the stock is worth. If the feed is quiet, the pool keeps the last price until it updates.",
  },
  {
    id: "wrapper",
    term: "Wrapper",
    text: "A wrapper is the token an issuer makes for a stock, such as xStocks or bStocks. One company stock can have more than one wrapper.",
  },
] as const;

const BY_ID = new Map(LENDING_GLOSSARY.map((entry) => [entry.id, entry]));

export function lendingGlossary(id: string): LendingGlossaryEntry {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`Unknown lending glossary id: ${id}`);
  return entry;
}
