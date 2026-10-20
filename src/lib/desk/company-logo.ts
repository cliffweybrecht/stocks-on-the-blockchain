import { COMPANY_LOGO_FILES, type CompanyLogoPlate } from "@/lib/desk/company-logo-map";

export interface CompanyLogo {
  src: string;
  plate: CompanyLogoPlate;
}

/**
 * Real tickers that already end in X. Uppercase stripping must not turn them
 * into a different company. A lowercase `x` wrapper (`GDx`, `TSLAx`) is handled
 * before this, so General Dynamics does not become the GDX gold-miners ETF.
 */
const KEEP_TRAILING_X = new Set(["GDX", "GDXJ", "SOXX", "SPCX"]);

/**
 * One file, several on-chain symbols. SPYM is State Street's S&P 500 portfolio
 * ETF, so it uses the SPDR mark. GOOG and GOOGL share the Alphabet mark.
 */
const TICKER_ALIASES: Record<string, string> = {
  DESPXA: "SPY",
  FIGUREAI: "FIGURE",
  GOOG: "GOOGL",
  KLSH: "KALSHI",
  OPAI: "OPENAI",
  POLY: "POLYMARKET",
  SPACEX: "SPCX",
  SPXA: "SPY",
  SPYM: "SPY",
};

/** Robinhood feather. Other issuers stay off the badge until we have a real mark. */
const ROBINHOOD_BADGE = "/lending-logos/chains/robinhood.png";

function canonicalTicker(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9.]/g, "");
}

function pushTicker(out: string[], value: string) {
  const ticker = canonicalTicker(value);
  if (!ticker || ticker.length > 12 || out.includes(ticker)) return;
  out.push(ticker);
}

/**
 * Underlying ticker candidates, best first.
 * Wrapper suffixes are read from the raw symbol (`TSLAx`, `NVDAon`, `AAPLc`,
 * `wtNVDA`) before the uppercased form, so a suffix is not confused with a
 * ticker that merely ends in that letter.
 */
export function underlyingTickerCandidates(symbol: string, issuer?: string | null): string[] {
  const raw = symbol.trim();
  if (!raw) return [];
  const out: string[] = [];
  const issuerKey = (issuer ?? "").toLowerCase();
  // A lowercase wrapper (`GDx`, `TSLAx`) must not also be searched as the uppercased
  // symbol. That would turn General Dynamics into the GDX gold-miners ETF.
  let wrapped = false;

  if (/x$/.test(raw)) {
    pushTicker(out, raw.slice(0, -1));
    wrapped = true;
  }
  if (/on$/.test(raw)) {
    pushTicker(out, raw.slice(0, -2));
    wrapped = true;
  }
  if (/c$/.test(raw) && /[a-z]/.test(raw)) {
    pushTicker(out, raw.slice(0, -1));
    wrapped = true;
  }
  if (/^wt/i.test(raw)) {
    pushTicker(out, raw.slice(2));
    wrapped = true;
  }
  if (/^wb/i.test(raw)) {
    pushTicker(out, raw.slice(2));
    wrapped = true;
  }
  if (/^b[A-Z]/.test(raw)) {
    pushTicker(out, raw.slice(1));
    wrapped = true;
  }
  if (/^a[A-Z]/.test(raw)) {
    pushTicker(out, raw.slice(1));
    wrapped = true;
  }
  if (/^x[A-Z]/.test(raw)) {
    pushTicker(out, raw.slice(1));
    wrapped = true;
  }
  if (/^p[A-Z]/.test(raw)) {
    pushTicker(out, raw.slice(1));
    wrapped = true;
  }
  if (/^de[A-Z]/.test(raw)) {
    pushTicker(out, raw.slice(2));
    wrapped = true;
  }
  if (/^t[A-Z]/.test(raw) && /[a-z]/.test(raw)) {
    pushTicker(out, raw.slice(1));
    wrapped = true;
  }
  if (issuerKey.includes("bstock") && /B$/.test(raw) && raw.length > 1) {
    pushTicker(out, raw.slice(0, -1));
    wrapped = true;
  }
  if (wrapped) return out;

  pushTicker(out, raw);

  const upper = canonicalTicker(raw);
  if (upper.endsWith("ON") && upper.length > 3) pushTicker(out, upper.slice(0, -2));
  if (upper.endsWith("X") && upper.length > 2 && !KEEP_TRAILING_X.has(upper)) pushTicker(out, upper.slice(0, -1));
  if (upper.endsWith("B") && upper.length > 2) pushTicker(out, upper.slice(0, -1));
  if (upper.startsWith("WT") && upper.length > 2) pushTicker(out, upper.slice(2));
  return out;
}

function fileForTicker(ticker: string): CompanyLogo | null {
  const hyphenated = ticker.replace(/\./g, "-");
  const keys = [ticker, hyphenated, TICKER_ALIASES[ticker], TICKER_ALIASES[hyphenated]].filter(
    (key): key is string => Boolean(key),
  );
  for (const key of keys) {
    const file = COMPANY_LOGO_FILES[key];
    if (file) return file;
  }
  return null;
}

/** Bundled company mark for a tokenized equity, ETF, or private name. Null when we have none. */
export function companyLogoForSymbol(symbol: string, issuer?: string | null): CompanyLogo | null {
  for (const ticker of underlyingTickerCandidates(symbol, issuer)) {
    const file = fileForTicker(ticker);
    if (file) return file;
  }
  return null;
}

/** Small issuer mark drawn on the corner of a company logo. */
export function issuerBadgeSrc(issuer: string | null | undefined): string | null {
  if (!issuer) return null;
  const key = issuer.trim().toLowerCase();
  if (key === "rhj" || key.includes("robinhood")) return ROBINHOOD_BADGE;
  return null;
}
