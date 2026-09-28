import type { AssetPoolMark } from "@/lib/market/types";

export interface MarketVenue {
  /** Canonical venue id (DexScreener `dexId`, lowercased, aliases collapsed). */
  id: string;
  /** Short label for the tooltip and the text fallback. */
  name: string;
  /** Local mini logo. Null when this desk has no asset for the id. */
  logoSrc: string | null;
}

interface VenueSpec {
  name: string;
  logo: boolean;
}

/**
 * Common DexScreener venue ids. Logos live in `public/venues` and are only
 * listed when the file is a real mark — DexScreener's CDN serves one generic
 * placeholder for unknown ids, and that file is not used here.
 */
const VENUES: Record<string, VenueSpec> = {
  raydium: { name: "Raydium", logo: true },
  orca: { name: "Orca", logo: true },
  meteora: { name: "Meteora", logo: true },
  meteoradbc: { name: "Meteora", logo: true },
  phoenix: { name: "Phoenix", logo: true },
  pumpswap: { name: "PumpSwap", logo: true },
  pumpfun: { name: "Pump.fun", logo: true },
  lifinity: { name: "Lifinity", logo: true },
  fluxbeam: { name: "FluxBeam", logo: true },
  openbook: { name: "OpenBook", logo: true },
  invariant: { name: "Invariant", logo: true },
  crema: { name: "Crema", logo: true },
  saber: { name: "Saber", logo: true },
  aldrin: { name: "Aldrin", logo: true },
  cropper: { name: "Cropper", logo: true },
  saros: { name: "Saros", logo: true },
  bonkswap: { name: "BonkSwap", logo: true },
  penguin: { name: "Penguin", logo: true },
  zerofi: { name: "ZeroFi", logo: true },
  solfi: { name: "SolFi", logo: true },
  humidifi: { name: "HumidiFi", logo: true },
  byreal: { name: "Byreal", logo: true },
  pancakeswap: { name: "PancakeSwap", logo: true },
  stabble: { name: "Stabble", logo: true },
  goosefx: { name: "GooseFX", logo: true },
  sanctum: { name: "Sanctum", logo: true },
  launchlab: { name: "LaunchLab", logo: true },
  heaven: { name: "Heaven", logo: true },
  fusion: { name: "Fusion", logo: true },
  manifest: { name: "Manifest", logo: true },
  serum: { name: "Serum", logo: true },
  obric: { name: "Obric", logo: true },
  moonit: { name: "Moonit", logo: true },
  dexlab: { name: "Dexlab", logo: true },
  dooar: { name: "Dooar", logo: true },
  stepn: { name: "STEPN", logo: true },
  deltafi: { name: "DeltaFi", logo: true },
  uniswap: { name: "Uniswap", logo: true },
  sushi: { name: "Sushi", logo: true },
  camelot: { name: "Camelot", logo: true },
  curve: { name: "Curve", logo: true },
  aerodrome: { name: "Aerodrome", logo: true },
  moonshot: { name: "Moonshot", logo: false },
  boop: { name: "Boop", logo: false },
  wavebreak: { name: "Wavebreak", logo: false },
  vertigo: { name: "Vertigo", logo: false },
  tokenmill: { name: "TokenMill", logo: false },
};

/** Same brand, different DexScreener spelling. */
const ALIASES: Record<string, string> = {
  sushiswap: "sushi",
  "pump.fun": "pumpfun",
  "pump-fun": "pumpfun",
  whirlpool: "orca",
  whirlpools: "orca",
  "orca-whirlpool": "orca",
  raydiumclmm: "raydium",
  "raydium-clmm": "raydium",
  raydiumcpmm: "raydium",
  "raydium-cpmm": "raydium",
  raydiumamm: "raydium",
  "raydium-v4": "raydium",
  "raydium-launchlab": "launchlab",
  raydiumlaunchlab: "launchlab",
  "meteora-dlmm": "meteora",
  "meteora-dyn": "meteora",
  "meteora-damm": "meteora",
  meteoraamm: "meteora",
  "meteora-dbc": "meteoradbc",
};

/**
 * DexScreener pool-type labels. These describe the curve, not a second venue.
 * "wp" is Orca Whirlpool, "CLMM"/"CPMM" are Raydium, "DLMM"/"DYN" are Meteora.
 */
const POOL_MECHANICS = new Set([
  "amm",
  "clmm",
  "concentrated",
  "cpmm",
  "damm",
  "dammv2",
  "dlmm",
  "dyn",
  "dyn1",
  "dyn2",
  "stable",
  "stableswap",
  "standard",
  "v2",
  "v3",
  "v4",
  "wp",
]);

function humanizeDexId(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function canonicalVenueId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const id = raw.trim().toLowerCase();
  if (!id || id === "unknown") return null;
  if (POOL_MECHANICS.has(id)) return null;
  return ALIASES[id] ?? id;
}

function toVenue(id: string): MarketVenue {
  const spec = VENUES[id];
  return {
    id,
    name: spec?.name ?? humanizeDexId(id),
    logoSrc: spec?.logo ? `/venues/${id}.png` : null,
  };
}

/**
 * Venues for one Markets row. The DexScreener `dexId` is the host. A pair
 * label is a second icon only when it names another known venue — curve
 * labels such as CLMM stay off the row.
 */
export function marketsPoolVenues(pool: Pick<AssetPoolMark, "dexId" | "labels">): MarketVenue[] {
  const seen = new Set<string>();
  const venues: MarketVenue[] = [];

  const push = (id: string, fromLabel: boolean) => {
    if (seen.has(id)) return;
    if (fromLabel && !VENUES[id]) return;
    seen.add(id);
    venues.push(toVenue(id));
  };

  const primary = canonicalVenueId(pool.dexId);
  if (primary) push(primary, false);

  for (const label of pool.labels ?? []) {
    const id = canonicalVenueId(label);
    if (id) push(id, true);
  }

  return venues;
}
