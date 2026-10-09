import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";
import ChainPage from "@/app/chains/[chainId]/page";
import { createMarketDataSource } from "@/lib/market/factory";
import { SolanaMarketDataSource } from "@/lib/market/solana-source";
import { BASE_CHAIN_ID, BNB_CHAIN_ID, ROBINHOOD_CHAIN_ID, SOLANA_CHAIN_ID } from "@/lib/market/types";
import { easternMidnightUnix } from "@/lib/market/volume-snapshots";
import { GET } from "./route";

const SNAPSHOTS = ["solana.json", "base.json", "bnb.json", "robinhood.json"];

/** Every tracked desk file a page or API load could rewrite. */
const TRACKED = [
  ...SNAPSHOTS.map((name) => join("data", "volume-snapshots", name)),
  join("data", "volume-snapshots", "solana-hourly.json"),
  join("data", "volume-snapshots", "solana-asset-daily.json"),
  join("data", "volume-snapshots", "base-asset-daily.json"),
  join("data", "volume-snapshots", "bnb-asset-daily.json"),
  join("data", "volume-snapshots", "robinhood-asset-daily.json"),
  join("data", "perps-snapshots", "perps.json"),
];

const PAGE_ENV: Record<string, string> = {
  SOLANA_MARKET_ENABLED: "true",
  SOLANA_REQUEST_GAP_MS: "0",
  SOLANA_TIMEOUT_MS: "2000",
  SOLANA_HOME_BUDGET_MS: "200",
  SOLANA_FULL_BUDGET_MS: "200",
  SOLANA_ENRICH_BUDGET_MS: "0",
  SOLANA_XSTOCKS_REGISTRY_ENABLED: "false",
  SOLANA_ONDO_REGISTRY_ENABLED: "false",
  SOLANA_TESSERA_REGISTRY_ENABLED: "false",
  SOLANA_SUNRISE_REGISTRY_ENABLED: "false",
  SOLANA_GECKOTERMINAL_ENABLED: "false",
  SOLANA_JUPITER_TOKEN_LOGOS_ENABLED: "false",
  SOLANA_JUPITER_HOLDERS_ENABLED: "false",
  SOLANA_PAIR_HOLDERS_ENABLED: "false",
  SOLANA_MINT_SUPPLY_ENABLED: "false",
};

const TSLA_PAIR = {
  chainId: "solana",
  dexId: "raydium",
  pairAddress: "pair-1",
  baseToken: {
    address: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    name: "Tesla xStock",
    symbol: "TSLAx",
  },
  quoteToken: { address: "usdc", name: "USDC", symbol: "USDC" },
  volume: { h24: 1_250.25 },
  liquidity: { usd: 9_000 },
};

function porcelain(path: string): string {
  return execFileSync("git", ["status", "--porcelain", "--", path], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function snapshotBytes(): Array<{ path: string; text: string; status: string }> {
  return TRACKED.map((path) => ({ path, text: readFileSync(path, "utf8"), status: porcelain(path) }));
}

function expectUntouched(before: Array<{ path: string; text: string; status: string }>): void {
  for (const row of before) {
    expect(readFileSync(row.path, "utf8")).toBe(row.text);
    expect(porcelain(row.path)).toBe(row.status);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.includes("dexscreener.com") && url.includes("/latest/dex/search")) {
    return Promise.resolve(jsonResponse({ pairs: [TSLA_PAIR] }));
  }
  if (url.includes("dexscreener.com") && (url.includes("/tokens/") || url.includes("/token-pairs/"))) {
    return Promise.resolve(jsonResponse([TSLA_PAIR]));
  }
  return Promise.resolve(jsonResponse({}, 404));
}

async function settleLiveDesk(): Promise<void> {
  const source = createMarketDataSource();
  await Promise.allSettled([
    source.listChains(),
    source.getChain(SOLANA_CHAIN_ID),
    source.getEquityVolumeHistory(),
    source.getClosedDeskVolumeHistory(),
    source.getLiveDeskRolling24h(),
  ]);
  if (source instanceof SolanaMarketDataSource) await source.flushBackgroundWork();
  await new Promise((resolve) => setTimeout(resolve, 200));
}

describe("GET /api/solana/desk-volume-history", () => {
  it("leaves tracked snapshot files untouched and keeps every record t on New York midnight", async () => {
    const previous = process.env.SOLANA_MARKET_ENABLED;
    process.env.SOLANA_MARKET_ENABLED = "true";
    try {
      const before = snapshotBytes();

      const response = await GET();
      expect(response.status).toBe(200);
      const body = (await response.json()) as { history?: { points?: unknown } };
      expect(Array.isArray(body.history?.points)).toBe(true);

      expectUntouched(before);
      for (const name of SNAPSHOTS) {
        const payload = JSON.parse(readFileSync(join("data", "volume-snapshots", name), "utf8")) as {
          records?: Array<{ date?: unknown; t?: unknown }>;
        };
        const records = payload.records ?? [];
        expect(records.length).toBeGreaterThan(0);
        for (const record of records) {
          expect(typeof record.date).toBe("string");
          expect(record.t).toBe(easternMidnightUnix(String(record.date)));
        }
      }
    } finally {
      if (previous === undefined) delete process.env.SOLANA_MARKET_ENABLED;
      else process.env.SOLANA_MARKET_ENABLED = previous;
    }
  });
});

describe("home and chain page loads", () => {
  it("leaves tracked snapshot files byte-identical after / and the chain pages", async () => {
    const previousEnv = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(PAGE_ENV)) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = value;
    }
    const previousFetch = globalThis.fetch;
    globalThis.fetch = stubFetch as typeof fetch;
    try {
      const before = snapshotBytes();
      await HomePage();
      for (const chainId of [SOLANA_CHAIN_ID, BASE_CHAIN_ID, BNB_CHAIN_ID, ROBINHOOD_CHAIN_ID]) {
        await ChainPage({
          params: Promise.resolve({ chainId }),
          searchParams: Promise.resolve({}),
        });
      }
      await settleLiveDesk();
      expectUntouched(before);
    } finally {
      globalThis.fetch = previousFetch;
      for (const [key, value] of previousEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }, 30_000);

  it("renders / and /chains/solana from the snapshot while DexScreener hangs", async () => {
    const hangEnv: Record<string, string> = {
      ...PAGE_ENV,
      SOLANA_DEXSCREENER_BASE_URL: "https://desk-hang.invalid",
      SOLANA_TIMEOUT_MS: "30000",
    };
    const previousEnv = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(hangEnv)) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = value;
    }
    const previousFetch = globalThis.fetch;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof fetch;
    try {
      const before = snapshotBytes();
      const started = Date.now();
      const home = await HomePage();
      await ChainPage({
        params: Promise.resolve({ chainId: SOLANA_CHAIN_ID }),
        searchParams: Promise.resolve({}),
      });
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(home).toBeTruthy();
      expectUntouched(before);
    } finally {
      globalThis.fetch = previousFetch;
      for (const [key, value] of previousEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }, 12_000);
});
