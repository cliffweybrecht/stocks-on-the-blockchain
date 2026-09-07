import { asNonEmptyString } from "./numbers";

export interface TokenIdentity {
  address: string;
  symbol?: string | null;
  name?: string | null;
  labels?: readonly string[] | null;
}

export interface EquityClassification {
  kind: "equity";
  issuer: string | null;
  reason: string;
}

export interface RejectClassification {
  kind: "reject";
  reason: string;
}

export type TokenClassification = EquityClassification | RejectClassification;

const CRYPTO_STABLE_SYMBOLS = new Set([
  "BONK",
  "BTC",
  "CBTC",
  "DAI",
  "ETH",
  "FARTCOIN",
  "FDUSD",
  "HNT",
  "INF",
  "JITO",
  "JITOSOL",
  "JLP",
  "JTO",
  "JUP",
  "MSOL",
  "ORCA",
  "PENGU",
  "POPCAT",
  "PYTH",
  "PYUSD",
  "RAY",
  "RENDER",
  "SOL",
  "TRUMP",
  "USDC",
  "USDH",
  "USDS",
  "USDT",
  "USDG",
  "USD1",
  "UST",
  "WBTC",
  "WETH",
  "WIF",
  "WSOL",
]);

const COMMODITY_SYMBOLS = new Set(["GOLD", "OIL", "PAXG", "SILVER", "XAG", "XAU", "XAUT"]);

const ETF_INDEX_SYMBOLS = new Set([
  "DIA",
  "DIAX",
  "IVV",
  "IVVX",
  "IWM",
  "IWMX",
  "QQQ",
  "QQQX",
  "SPY",
  "SPYX",
  "VOO",
  "VOOX",
  "VTI",
  "VTIX",
]);

const GENERIC_CATEGORY_SYMBOLS = new Set(["EQUITY", "RWA", "STOCK", "STOCKS", "XSTOCK", "XSTOCKS"]);

const EQUITY_LABELS = new Set([
  "equity",
  "rwa-equity",
  "rwa-stock",
  "stock",
  "tokenized-equity",
  "tokenized-share",
  "tokenized-stock",
]);

const ETF_LABELS = new Set(["etf", "equity-etf", "index", "index-fund"]);

const ISSUER_NAME_PATTERNS: readonly { re: RegExp; issuer: string }[] = [
  { re: /\bxstocks?\b/i, issuer: "Backed / xStocks" },
  { re: /\bdinari\b/i, issuer: "Dinari" },
  { re: /\bdshares?\b/i, issuer: "dShares" },
  { re: /\bbacked(?:\s+finance)?\b/i, issuer: "Backed" },
];

const ETF_NAME =
  /\b(?:etf|s&p(?:\s*500)?|sp500|sp\s*500|nasdaq(?:-?100)?|dow\s*jones|russell(?:\s*2000)?|index\s+fund|ishares|spdr|spyder)\b/i;

const COMMODITY_NAME = /\b(?:gold|silver|crude\s+oil|precious\s+metal|commodity|commodities|pax\s*gold)\b/i;

const CRYPTO_NAME =
  /\b(?:usd\s*coin|tether|wrapped\s+sol|wrapped\s+bitcoin|wrapped\s+ether|memecoin|meme\s+coin|stablecoin)\b/i;

const NON_PUBLIC_EQUITY_NAME =
  /\b(?:prestocks?|pre-?ipo|pre\s+ipo|real\s+estate|treasury|t-?bills?|money\s+market|private\s+credit|spacex|xai|openai|anthropic|stripe)\b/i;

const GENERIC_CATEGORY_NAME =
  /^(?:the\s+)?(?:xstocks?|tokeni[sz]ed(?:\s+public)?\s+(?:stocks?|equit(?:y|ies)|shares?))$/i;

const COMPANY_XSTOCK_NAME = /\S.+\bxstocks?\b/i;

const TOKENIZED_EQUITY_PHRASE = /\btokeni[sz]ed(?:\s+public)?\s+(?:stock|equity|share|shares)\b/i;

function normalizeSymbol(symbol: string | null | undefined): string | null {
  const raw = asNonEmptyString(symbol);
  if (!raw) return null;
  return raw.replace(/^\$/, "").toUpperCase();
}

function readLabels(labels: TokenIdentity["labels"]): string[] {
  if (!labels) return [];
  return labels.map((label) => label.trim().toLowerCase()).filter((label) => label.length > 0);
}

export function tokenIdentityFromFields(input: {
  address?: unknown;
  symbol?: unknown;
  name?: unknown;
  labels?: readonly string[] | null;
}): TokenIdentity | null {
  const address = asNonEmptyString(input.address);
  if (!address) return null;
  return {
    address,
    symbol: asNonEmptyString(input.symbol),
    name: asNonEmptyString(input.name),
    labels: input.labels ?? [],
  };
}

export function inferIssuer(name: string | null, symbol: string | null, address: string): string | null {
  if (name) {
    for (const pattern of ISSUER_NAME_PATTERNS) {
      if (pattern.re.test(name) && !GENERIC_CATEGORY_NAME.test(name.trim())) {
        return pattern.issuer;
      }
    }
  }
  if (/^Xs/.test(address) && /^[A-Z]{1,5}X$/i.test(symbol ?? "")) {
    return "Backed / xStocks";
  }
  return null;
}

function tickerLike(symbol: string | null): boolean {
  return Boolean(symbol && /^[A-Z]{1,5}$/.test(symbol));
}

function backedTickerSymbol(symbol: string | null): boolean {
  return Boolean(symbol && /^[A-Z]{1,5}X$/.test(symbol));
}

function isGenericCategory(name: string | null, symbol: string | null): boolean {
  if (symbol && GENERIC_CATEGORY_SYMBOLS.has(symbol)) return true;
  return Boolean(name && GENERIC_CATEGORY_NAME.test(name));
}

export function classifyTokenizedEquity(token: TokenIdentity): TokenClassification {
  const address = asNonEmptyString(token.address);
  if (!address) {
    return { kind: "reject", reason: "missing mint" };
  }

  const name = asNonEmptyString(token.name);
  const symbol = normalizeSymbol(token.symbol);
  const labels = readLabels(token.labels);

  if (!name && !symbol) {
    return { kind: "reject", reason: "missing name and symbol" };
  }

  if (symbol && CRYPTO_STABLE_SYMBOLS.has(symbol)) {
    return { kind: "reject", reason: "crypto or stablecoin symbol" };
  }
  if (symbol && COMMODITY_SYMBOLS.has(symbol)) {
    return { kind: "reject", reason: "commodity symbol" };
  }
  if (name && CRYPTO_NAME.test(name)) {
    return { kind: "reject", reason: "crypto or stablecoin name" };
  }
  if (name && COMMODITY_NAME.test(name)) {
    return { kind: "reject", reason: "commodity name" };
  }
  if (name && NON_PUBLIC_EQUITY_NAME.test(name)) {
    return { kind: "reject", reason: "not a public equity" };
  }
  if (isGenericCategory(name, symbol)) {
    return { kind: "reject", reason: "generic category token" };
  }

  if (symbol && ETF_INDEX_SYMBOLS.has(symbol)) {
    return { kind: "reject", reason: "ETF or index symbol" };
  }
  if (name && ETF_NAME.test(name)) {
    return { kind: "reject", reason: "ETF or index name" };
  }
  if (labels.some((label) => ETF_LABELS.has(label))) {
    return { kind: "reject", reason: "ETF or index label" };
  }

  const issuer = inferIssuer(name, token.symbol ?? null, address);

  if (name && COMPANY_XSTOCK_NAME.test(name)) {
    if (!/^Xs/.test(address)) {
      return { kind: "reject", reason: "xStock branding without Backed mint convention" };
    }
    return { kind: "equity", issuer: issuer ?? "Backed / xStocks", reason: "xStock name" };
  }

  if (name && TOKENIZED_EQUITY_PHRASE.test(name) && !GENERIC_CATEGORY_NAME.test(name) && tickerLike(symbol)) {
    return { kind: "equity", issuer, reason: "tokenized equity phrase" };
  }

  if (labels.some((label) => EQUITY_LABELS.has(label)) && (tickerLike(symbol) || backedTickerSymbol(symbol))) {
    return { kind: "equity", issuer, reason: "explicit equity label" };
  }

  if (issuer && issuer !== "Backed / xStocks" && (tickerLike(symbol) || backedTickerSymbol(symbol))) {
    return { kind: "equity", issuer, reason: "known issuer with equity signal" };
  }

  if (backedTickerSymbol(symbol) && name && /\b(?:stock|equity|share)s?\b/i.test(name) && /^Xs/.test(address)) {
    return { kind: "equity", issuer: issuer ?? "Backed / xStocks", reason: "tickerx symbol with equity name" };
  }

  if (backedTickerSymbol(symbol) && /^Xs/.test(address)) {
    return { kind: "equity", issuer: issuer ?? "Backed / xStocks", reason: "Backed mint convention plus tickerx" };
  }

  if (
    name &&
    /\btokeni[sz]ed\b/i.test(name) &&
    /\b(?:stock|equity|shares?)\b/i.test(name) &&
    tickerLike(symbol) &&
    !GENERIC_CATEGORY_NAME.test(name)
  ) {
    return { kind: "equity", issuer, reason: "tokenized plus ticker symbol" };
  }

  return { kind: "reject", reason: "no verifiable tokenized-equity signal" };
}

export function classifyOrNull(token: TokenIdentity): EquityClassification | null {
  const result = classifyTokenizedEquity(token);
  return result.kind === "equity" ? result : null;
}
