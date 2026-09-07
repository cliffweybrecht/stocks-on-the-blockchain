import { asNonEmptyString } from "./numbers";
import { tokenIdentityFromFields, type TokenIdentity } from "./solana-classifier";

export const DEFAULT_XSTOCKS_REGISTRY_BASE_URL = "https://api.xstocks.fi/api/v2";
export const XSTOCKS_REGISTRY_PAGE_SIZE = 100;
export const XSTOCKS_REGISTRY_MAX_PAGES = 20;

export function xStocksAssetsPath(page: number, pageSize = XSTOCKS_REGISTRY_PAGE_SIZE): string {
  const params = new URLSearchParams({
    network: "Solana",
    page: String(page),
    pageSize: String(pageSize),
  });
  return `/public/assets?${params.toString()}`;
}

export function parseXStocksAssetsPage(payload: unknown): {
  identities: TokenIdentity[];
  hasNextPage: boolean;
} {
  if (!payload || typeof payload !== "object") {
    throw new Error("xStocks registry response was not an object.");
  }
  const body = payload as { nodes?: unknown; page?: { hasNextPage?: unknown } };
  if (!Array.isArray(body.nodes)) {
    throw new Error("xStocks registry response was not an asset list.");
  }

  const identities: TokenIdentity[] = [];
  for (const node of body.nodes) {
    if (!node || typeof node !== "object") continue;
    const row = node as {
      name?: unknown;
      symbol?: unknown;
      deployments?: unknown;
      underlying?: { type?: unknown };
      underlyingType?: unknown;
    };
    if (!Array.isArray(row.deployments)) continue;
    const underlyingType = row.underlying?.type ?? row.underlyingType;
    for (const deployment of row.deployments) {
      if (!deployment || typeof deployment !== "object") continue;
      const dep = deployment as { network?: unknown; address?: unknown };
      if (asNonEmptyString(dep.network) !== "Solana") continue;
      const identity = tokenIdentityFromFields({
        address: dep.address,
        symbol: row.symbol,
        name: row.name,
        underlyingInstrumentType: underlyingType,
      });
      if (identity) identities.push(identity);
    }
  }

  return {
    identities,
    hasNextPage: body.page?.hasNextPage === true,
  };
}
