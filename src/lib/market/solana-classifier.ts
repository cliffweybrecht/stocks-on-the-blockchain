import { asNonEmptyString } from "./numbers";

export type UnderlyingInstrumentType = "equity" | "etf";

export interface TokenIdentity {
  address: string;
  symbol?: string | null;
  name?: string | null;
  labels?: readonly string[] | null;
  /** Live issuer instrument class when a registry provides it. Not a mint allowlist. */
  underlyingInstrumentType?: UnderlyingInstrumentType | null;
}

export interface EquityClassification {
  kind: "equity";
  issuer: string | null;
  reason: string;
}

export interface EtfClassification {
  kind: "etf";
  issuer: string | null;
  reason: string;
}

export interface RejectClassification {
  kind: "reject";
  reason: string;
}

export type TokenClassification = EquityClassification | EtfClassification | RejectClassification;

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
  "USDY",
  "USDON",
  "OUSG",
  "OMMF",
  "WBTC",
  "WETH",
  "WIF",
  "WSOL",
]);

const COMMODITY_SYMBOLS = new Set(["GOLD", "OIL", "PAXG", "SILVER", "XAG", "XAU", "XAUT"]);

const ETF_INDEX_SYMBOLS = new Set([
  "BITX",
  "BITXX",
  "DIA",
  "DIAX",
  "EEM",
  "EEMX",
  "IVV",
  "IVVX",
  "IWM",
  "IWMX",
  "JPST",
  "JPSTX",
  "PSQ",
  "PSQX",
  "QLD",
  "QLDX",
  "QQQ",
  "QQQX",
  "SGOV",
  "SGOVX",
  "SLV",
  "SLVX",
  "SOXL",
  "SOXLX",
  "SOXS",
  "SOXSX",
  "SPXL",
  "SPXLX",
  "SPY",
  "SPYX",
  "SQQQ",
  "SQQQX",
  "TBLL",
  "TBLLX",
  "TNA",
  "TNAX",
  "TQQQ",
  "TQQQX",
  "TLT",
  "TLTX",
  "TZA",
  "TZAX",
  "UPRO",
  "UPROX",
  "UVXY",
  "UVXYX",
  "VOO",
  "VOOX",
  "VTI",
  "VTIX",
  "IBIT",
  "IBITX",
  "IBITON",
  "GLD",
  "GLDX",
  "GLDON",
  "GDXX",
  "GDXON",
  "GDXJ",
  "GDXJX",
  "EFA",
  "EFAX",
  "EFAON",
  "IEFA",
  "IEFAX",
  "IEFAON",
  "IEMG",
  "IEMGX",
  "IEMGON",
  "AGG",
  "AGGX",
  "AGGON",
  "BND",
  "BNDX",
  "BNDON",
  "VNQ",
  "VNQX",
  "VNQON",
  "XLF",
  "XLFX",
  "XLFON",
  "XLK",
  "XLKX",
  "XLKON",
  "XLE",
  "XLEX",
  "XLEON",
  "XLV",
  "XLVX",
  "XLVON",
  "SMH",
  "SMHX",
  "SMHON",
  "QQQM",
  "QQQMX",
  "QQQMON",
  "ARKK",
  "ARKKX",
  "ARKKON",
  "HYG",
  "HYGX",
  "HYGON",
  "LQD",
  "LQDX",
  "LQDON",
  "BIL",
  "BILX",
  "BILON",
  "SHV",
  "SHVX",
  "SHVON",
  "USO",
  "USOX",
  "USOON",
  "BITO",
  "BITOX",
  "BITOON",
  "GBTC",
  "GBTCX",
  "GBTCON",
  "JEPI",
  "JEPIX",
  "JEPION",
  "JEPQ",
  "JEPQX",
  "JEPQON",
  "VEA",
  "VEAX",
  "VEAON",
  "VWO",
  "VWOX",
  "VWOON",
  "ITOT",
  "ITOTX",
  "ITOTON",
  "SPLG",
  "SPLGX",
  "SPLGON",
  "MAGS",
  "MAGSX",
  "MAGSON",
  "EWY",
  "EWYX",
  "EWYON",
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
  { re: /\bondo\b/i, issuer: "Ondo" },
];

const ETF_NAME =
  /\b(?:etf|s&p(?:\s*500)?|sp500|sp\s*500|nasdaq-?100|nasdaq\s+xstocks?|dow\s*jones|russell(?:\s*2000)?|index|ishares|spdr|spyder|vanguard|vaneck|direxion|global\s+x|roundhill|proshares|volatility\s+shares|2x\s+long|3x\s+(?:long|short)|leveraged|ultra-?short|ultra-?pro|silver trust|gold miners|bitcoin strategy)\b/i;

const COMMODITY_PRODUCT_NAME =
  /^(?:tokeni[sz]ed\s+)?(?:gold|silver|crude\s+oil|precious\s+metal|pax\s*gold)(?:\s+xstocks?)?$/i;

const CRYPTO_NAME =
  /\b(?:usd\s*coin|tether|wrapped\s+sol|wrapped\s+bitcoin|wrapped\s+ether|memecoin|meme\s+coin|stablecoin)\b/i;

const PRIVATE_OR_PREIPO_NAME =
  /\b(?:prestocks?|pre-?ipo|pre\s+ipo|spacex|xai|openai|anthropic|stripe|shein)\b/i;

const PRIVATE_BASE_SYMBOLS = new Set(["SPCX", "SPACEX", "OPENAI", "SHEIN", "XAI", "STRIPE", "ANTHROPIC"]);

const ONDO_NON_EQUITY_NAME =
  /\b(?:usdy|ousg|ommf|usd\s*y|dollar\s+yield|tokenized\s+currency|us\s+dollar\s+yield|treasury\s+bill)\b/i;

const ONDO_TOKENIZED_NAME = /\bondo\s+tokenized\b|\(ondo tokenized\)|tokenized\s+stock\s+\(ondo\)/i;

const TOKENIZED_REAL_ESTATE_RWA = /tokeni[sz]ed\s+real\s+estate/i;

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

export function parseUnderlyingInstrumentType(value: unknown): UnderlyingInstrumentType | null {
  const raw = asNonEmptyString(value)?.toLowerCase();
  if (raw === "equity") return "equity";
  if (raw === "etf") return "etf";
  return null;
}

export function tokenIdentityFromFields(input: {
  address?: unknown;
  symbol?: unknown;
  name?: unknown;
  labels?: readonly string[] | null;
  underlyingInstrumentType?: unknown;
}): TokenIdentity | null {
  const address = asNonEmptyString(input.address);
  if (!address) return null;
  return {
    address,
    symbol: asNonEmptyString(input.symbol),
    name: asNonEmptyString(input.name),
    labels: input.labels ?? [],
    underlyingInstrumentType: parseUnderlyingInstrumentType(input.underlyingInstrumentType),
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
  if (ondoMintConvention(address, symbol)) {
    return "Ondo";
  }
  return null;
}

function tickerLike(symbol: string | null): boolean {
  return Boolean(symbol && /^[A-Z]{1,5}$/.test(symbol));
}

function backedTickerSymbol(symbol: string | null): boolean {
  return Boolean(symbol && /^[A-Z]{1,5}X$/.test(symbol));
}

export function ondoTickerSymbol(symbol: string | null): boolean {
  return Boolean(symbol && /^[A-Z]{1,5}ON$/.test(symbol));
}

export function ondoMintConvention(address: string, symbol: string | null): boolean {
  return /ondo$/i.test(address) && ondoTickerSymbol(symbol);
}

function isGenericCategory(name: string | null, symbol: string | null): boolean {
  if (symbol && GENERIC_CATEGORY_SYMBOLS.has(symbol)) return true;
  return Boolean(name && GENERIC_CATEGORY_NAME.test(name));
}

function privateCompanySymbol(symbol: string | null): boolean {
  if (!symbol) return false;
  if (PRIVATE_BASE_SYMBOLS.has(symbol)) return true;
  if (symbol.endsWith("ON") && PRIVATE_BASE_SYMBOLS.has(symbol.slice(0, -2))) return true;
  if (symbol.endsWith("X") && PRIVATE_BASE_SYMBOLS.has(symbol.slice(0, -1))) return true;
  return false;
}

export function isEtfOrIndexSymbol(symbol: string | null): boolean {
  if (!symbol) return false;
  if (ETF_INDEX_SYMBOLS.has(symbol)) return true;
  // Strip Ondo `on` suffix only. Do not strip a trailing `x`: GDx (General Dynamics)
  // must not be treated as GDX (VanEck Gold Miners).
  if (symbol.endsWith("ON") && ETF_INDEX_SYMBOLS.has(symbol.slice(0, -2))) return true;
  return false;
}

function etfReason(token: TokenIdentity, name: string | null, symbol: string | null, labels: readonly string[]): string | null {
  if (isEtfOrIndexSymbol(symbol)) return "ETF or index symbol";
  if (name && ETF_NAME.test(name)) return "ETF or index name";
  if (labels.some((label) => ETF_LABELS.has(label))) return "ETF or index label";
  if (token.underlyingInstrumentType === "etf") return "issuer-classified ETF";
  return null;
}

function hasVerifiableInstrumentSignal(input: {
  address: string;
  name: string | null;
  symbol: string | null;
  issuer: string | null;
  labels: readonly string[];
  underlyingInstrumentType?: TokenIdentity["underlyingInstrumentType"];
}): { ok: true; reason: string } | { ok: false } {
  const { address, name, symbol, issuer, labels } = input;

  if (name && COMPANY_XSTOCK_NAME.test(name)) {
    if (!/^Xs/.test(address)) {
      return { ok: false };
    }
    return { ok: true, reason: "xStock name" };
  }

  if (name && ONDO_TOKENIZED_NAME.test(name)) {
    if (!/ondo$/i.test(address)) {
      return { ok: false };
    }
    return { ok: true, reason: "Ondo tokenized name" };
  }

  if (name && TOKENIZED_EQUITY_PHRASE.test(name) && !GENERIC_CATEGORY_NAME.test(name) && tickerLike(symbol)) {
    return { ok: true, reason: "tokenized equity phrase" };
  }

  if (labels.some((label) => EQUITY_LABELS.has(label)) && (tickerLike(symbol) || backedTickerSymbol(symbol) || ondoTickerSymbol(symbol))) {
    return { ok: true, reason: "explicit equity label" };
  }

  if (issuer && issuer !== "Backed / xStocks" && issuer !== "Ondo" && (tickerLike(symbol) || backedTickerSymbol(symbol) || ondoTickerSymbol(symbol))) {
    return { ok: true, reason: "known issuer with equity signal" };
  }

  if (backedTickerSymbol(symbol) && name && /\b(?:stock|equity|share)s?\b/i.test(name) && /^Xs/.test(address)) {
    return { ok: true, reason: "tickerx symbol with equity name" };
  }

  if (backedTickerSymbol(symbol) && /^Xs/.test(address)) {
    return { ok: true, reason: "Backed mint convention plus tickerx" };
  }

  if (ondoMintConvention(address, symbol)) {
    return { ok: true, reason: "Ondo mint convention plus tickeron" };
  }

  if (
    name &&
    /\btokeni[sz]ed\b/i.test(name) &&
    /\b(?:stock|equity|shares?)\b/i.test(name) &&
    (tickerLike(symbol) || ondoTickerSymbol(symbol)) &&
    !GENERIC_CATEGORY_NAME.test(name)
  ) {
    return { ok: true, reason: "tokenized plus ticker symbol" };
  }

  if (
    input.underlyingInstrumentType === "equity" &&
    (tickerLike(symbol) || backedTickerSymbol(symbol) || ondoTickerSymbol(symbol)) &&
    !isGenericCategory(name, symbol)
  ) {
    return { ok: true, reason: "issuer-classified public equity" };
  }

  return { ok: false };
}

export function classifyTokenizedInstrument(token: TokenIdentity): TokenClassification {
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
  if (name && COMMODITY_PRODUCT_NAME.test(name)) {
    return { kind: "reject", reason: "commodity product" };
  }
  if (name && ONDO_NON_EQUITY_NAME.test(name)) {
    return { kind: "reject", reason: "Ondo non-equity product" };
  }
  if (name && PRIVATE_OR_PREIPO_NAME.test(name)) {
    return { kind: "reject", reason: "not a public equity" };
  }
  if (privateCompanySymbol(symbol)) {
    return { kind: "reject", reason: "not a public equity" };
  }
  if (name && TOKENIZED_REAL_ESTATE_RWA.test(name)) {
    return { kind: "reject", reason: "real-estate RWA" };
  }
  if (isGenericCategory(name, symbol)) {
    return { kind: "reject", reason: "generic category token" };
  }
  if (name && ONDO_TOKENIZED_NAME.test(name) && !/ondo$/i.test(address)) {
    return { kind: "reject", reason: "Ondo branding without Ondo mint convention" };
  }

  const issuer = inferIssuer(name, symbol, address);
  const signal = hasVerifiableInstrumentSignal({
    address,
    name,
    symbol,
    issuer,
    labels,
    underlyingInstrumentType: token.underlyingInstrumentType,
  });
  const etf = etfReason(token, name, symbol, labels);

  if (etf) {
    if (signal.ok) {
      return { kind: "etf", issuer: issuer ?? (ondoMintConvention(address, symbol) ? "Ondo" : null), reason: etf };
    }
    return { kind: "reject", reason: etf };
  }

  if (name && COMPANY_XSTOCK_NAME.test(name) && !/^Xs/.test(address)) {
    return { kind: "reject", reason: "xStock branding without Backed mint convention" };
  }

  if (signal.ok) {
    return { kind: "equity", issuer, reason: signal.reason };
  }

  return { kind: "reject", reason: "no verifiable tokenized-equity signal" };
}

export function classifyTokenizedEquity(token: TokenIdentity): Exclude<TokenClassification, EtfClassification> {
  const result = classifyTokenizedInstrument(token);
  if (result.kind === "etf") {
    return { kind: "reject", reason: result.reason };
  }
  return result;
}

export function classifyOrNull(token: TokenIdentity): EquityClassification | null {
  const result = classifyTokenizedInstrument(token);
  return result.kind === "equity" ? result : null;
}

export function classifyEtfOrNull(token: TokenIdentity): EtfClassification | null {
  const result = classifyTokenizedInstrument(token);
  return result.kind === "etf" ? result : null;
}
