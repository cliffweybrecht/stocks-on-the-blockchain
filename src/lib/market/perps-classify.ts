/**
 * Equity-perp ticker classification.
 * Ported from the Oct 8 2026 research pass: single stocks, equity ETFs
 * (including leveraged), and equity indices stay; pre-IPO, commodities, FX,
 * bonds, and vol drop. Venues without an asset-type flag are matched later
 * by normalized ticker plus a price band against this universe.
 */

export type PerpsCategory = "stock" | "etf" | "leveraged-etf" | "index";

export type PerpsClass = PerpsCategory | "nonequity" | "etf-nonequity" | "preipo";

const NONEQ = new Set(
  `XAU XAG XPT XPD XAUT PAXG GOLD SILVER PLATINUM PALLADIUM COPPER XCU COPP COPPP CL WTI WTIOIL XTI USOIL USOILP USOILSPOT BZ BRENT BRENTOIL UKOIL UKOILP XBR NG NATGAS NGAS XNG HO DIESEL GASOLP COCOA COCOAP CORN WHEAT SOY TTF ALUMINIUM ALUMINUM XAL ZINC LEAD NICKEL XNI XPB URANIUM OIL XAGS XAUS GOLDJM SILVERJM
EUR GBP JPY CHF AUD CAD TRY BRL EURUSD GBPUSD USDJPY USDBRL USDKRW AUDUSD USDCHF NZDUSD USDCAD USDHKD KRW DXY DXIP USDCNH
10Y 2Y 30Y US10Y USBOND VIX VOL VXIP BVOL EVOL GVZ VOLX BVIV H100 B200 BTCD TOTAL2 OTHERS USDC USDE TWI`.split(
    /\s+/,
  ),
);

/** Listed ETFs whose exposure is commodity, bonds, crypto, or volatility. */
const ETF_NONEQ = new Set(
  "GLD SLV USO IAU UNG SGOV TLT TMF TBT HYG BITO IBIT BITU UVXY AGG BWET USDESTOCK USDE".split(/\s+/),
);

const PREIPO = new Set(
  "OPENAI OAI ANTHROPIC ANTH MOONSHOT KIMI POLYMARKET ANDURIL SPACEX SPCX OURA YMTC PRL UNITREE KALSHI".split(/\s+/),
);

const INDEX_ALIASES: Record<string, string> = {
  SPX: "S&P 500 index",
  SP500: "S&P 500 index",
  US500: "S&P 500 index",
  SPX500: "S&P 500 index",
  USA500: "S&P 500 index",
  US500S: "S&P 500 index",
  NDX: "Nasdaq-100 index",
  NDX100: "Nasdaq-100 index",
  US100: "Nasdaq-100 index",
  NAS100: "Nasdaq-100 index",
  USTECH: "Nasdaq-100 index",
  XYZ100: "Nasdaq-100 index",
  USA100: "Nasdaq-100 index",
  US100S: "Nasdaq-100 index",
  US30: "Dow 30 index",
  US2000: "Russell 2000 index",
  SMALL2000: "Russell 2000 index",
  JP225: "Nikkei/Japan 225 index",
  JPN225: "Nikkei/Japan 225 index",
  NIKKEI: "Nikkei/Japan 225 index",
  KR200: "KOSPI 200 index",
  KOSPI: "KOSPI index",
  HK50: "Hang Seng index",
  HSI: "Hang Seng index",
  HSCHKD: "HS China Ent. index",
  GER40: "DAX index",
  DAX: "DAX index",
  GDAXI: "DAX index",
  DE40: "DAX index",
  UK100: "FTSE 100 index",
  FTSE: "FTSE 100 index",
  UKX: "FTSE 100 index",
  DJI: "Dow 30 index",
  DJIA: "Dow 30 index",
  NIK: "Nikkei/Japan 225 index",
  NKY: "Nikkei/Japan 225 index",
  AUS200: "ASX 200 index",
  TW88: "Taiwan index",
  TWIS: "Taiwan index",
  CNA50S: "China A50 index",
  USFNGS: "NYSE FANG+ index",
  KRCOMP: "KOSPI index",
  SEMI: "Semis index (km)",
  USENERGY: "US energy index (km)",
  MAG7: "Mag7 basket",
};

const ETF_EQ = new Set(
  `SPY QQQ IWM DIA VOO SOXX SMH EWY EWJ EWT EWZ EWH INDA KWEB XLE XLK XLU XLV XLF XLI XBI IBB IGV GDX URNM URA REMX DRAM LYTE NCLD MAGS KSTR BOTZ ARKK VUG VGT RSP SNXX NVD SKUU XNDU KODEX200 SHLD JEPQ KR2550 SPYM`.split(
    /\s+/,
  ),
);

/**
 * Leveraged and inverse equity ETFs. Kept inside the equity universe, and
 * separable so the desk can hide them. 2L/3L/2S/3S names (CSOP and similar)
 * are included by suffix as well as this list.
 */
/**
 * Single-stock leveraged products that do not use a 2L/3L/2S/3S suffix.
 * MUU is Direxion Daily MU Bull 2X. MVLL and INTW are GraniteShares 2x long
 * MRVL and INTC. SKDD is GraniteShares 2x short the SK Hynix ADR. SKHY
 * (Nasdaq ADS) and SKHYNIX (KRX common) stay stocks and are not aliases.
 */
const LEVERAGED_ETF = new Set(
  `TQQQ SQQQ SOXL SOXS QLD QID SPXL SPXS UPRO SPXU SSO SDS TNA TZA UWM TWM URTY SRTY UDOW SDOW TECL TECS BULZ FNGU FNGD WEBL WEBS CURE LABU LABD FAS FAZ MIDU MIDZ HIBL HIBS NVDL NVDX NVDU TSLL TSLQ CONL MSTU MSTZ METU AMZU AAPU MSFU MSFB GGLL AAPB KORU DFEN WANT NAIL DRN MUU MVLL INTW SKDD CSOPSKHYNIX2L CSOPSAMSUNG2L CSOPSK2LHKD CSOPSS2LHKD`.split(
    /\s+/,
  ),
);

const ALIAS: Record<string, string> = {
  NVIDIA: "NVDA",
  TESLA: "TSLA",
  COINBASE: "COIN",
  ROBINHOOD: "HOOD",
  SMSN: "SAMSUNG",
  SKHX: "SKHYNIX",
  SKHYNIXUSD: "SKHYNIX",
  SAMSUNGUSD: "SAMSUNG",
  HYUNDAIUSD: "HYUNDAI",
  "BRK.B": "BRKB",
  ACNX: "ACN",
  QNTX: "QNT",
  BBX: "BB",
  STXX: "STX",
  GIGADEVICE: "GIGADEV",
  PURRDAT: "PURR",
  "SK HYNIX": "SKHYNIX",
  TCNT: "TENCENT",
  VISA: "V",
  /** Exchange suffix on an Alphabet contract. Same share class as GOOGL. */
  GOOGLX: "GOOGL",
};

const STRIP_SUFFIXES = [
  "-USDT-SWAP",
  "-USD-SWAP",
  "-SWAP-USDT",
  "-SWAP-USDC",
  "-USD-PERP",
  "-USDC-PERP",
  "USDTM",
  "_USDT_PERP",
  "_USDT",
  "_USDC",
  "_USD1",
  "USD1",
  "_USDG",
  "-USDT",
  "-USDC",
  "-USD.P",
  "-USD",
  "-PERPETUAL",
  "-PERP",
  "_PERP",
  "-SWAP",
  "/USD [USDC]",
  "USDT",
  "USDC",
  "USD",
];

export function normPerpSymbol(sym: string): string {
  let s = sym.toUpperCase();
  s = s.replace(/^[A-Z0-9]+:/, "");
  s = s.replace(/^(?:PF_|PI_)/, "");
  for (const suf of STRIP_SUFFIXES) {
    if (s.endsWith(suf) && s.length > suf.length) {
      s = s.slice(0, -suf.length);
      break;
    }
  }
  if (s.endsWith("_24_5")) s = s.slice(0, -5);
  if (s.endsWith("STOCK") && s.length > 5) s = s.slice(0, -5);
  return ALIAS[s] ?? s;
}

/** Explicit leveraged/inverse equity ETF tickers. Suffix rule is separate. */
export const PERPS_LEVERAGED_ETF_UNDERLYINGS: ReadonlySet<string> = LEVERAGED_ETF;
/** Pre-IPO names. Stored as a side stat, not in the headline or the ticker list. */
export const PERPS_PREIPO_UNDERLYINGS: ReadonlySet<string> = PREIPO;
/** Index aliases collapse to one underlying label. */
export const PERPS_INDEX_LABELS: Readonly<Record<string, string>> = INDEX_ALIASES;
/** CSOP-style leveraged suffixes. Applied only when the name is at least this long. */
export const PERPS_LEVERAGED_SUFFIX = /(?:2L|3L|2S|3S)$/;
export const PERPS_LEVERAGED_SUFFIX_MIN_LENGTH = 5;

function leveragedName(n: string): boolean {
  if (PERPS_LEVERAGED_ETF_UNDERLYINGS.has(n)) return true;
  return n.length >= PERPS_LEVERAGED_SUFFIX_MIN_LENGTH && PERPS_LEVERAGED_SUFFIX.test(n);
}

export function classifyPerpUnderlying(n: string): PerpsClass {
  if (NONEQ.has(n)) return "nonequity";
  if (ETF_NONEQ.has(n)) return "etf-nonequity";
  if (PREIPO.has(n)) return "preipo";
  if (n in INDEX_ALIASES) return "index";
  if (leveragedName(n)) return "leveraged-etf";
  if (ETF_EQ.has(n)) return "etf";
  return "stock";
}

export function isStoredEquityCategory(category: PerpsClass): category is PerpsCategory {
  return category === "stock" || category === "etf" || category === "leveraged-etf" || category === "index";
}

/** Collapse index aliases (US500 and SPX500) to one underlying label. */
export function perpGroupLabel(underlying: string): string {
  return INDEX_ALIASES[underlying] ?? underlying;
}

export function perpCategoryLabel(category: PerpsCategory): string {
  switch (category) {
    case "stock":
      return "Single stock";
    case "etf":
      return "ETF";
    case "leveraged-etf":
      return "Leveraged ETF";
    case "index":
      return "Index";
  }
}

export const PERPS_ZERO_FEE_VENUES = new Set([
  "MEXC",
  "Variational Omni",
  "Lighter",
  "Lighter on Robinhood Chain",
]);

export function perpVenueZeroFee(venue: string): boolean {
  return PERPS_ZERO_FEE_VENUES.has(venue);
}
