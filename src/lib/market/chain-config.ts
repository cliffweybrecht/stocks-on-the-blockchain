/**
 * Spot-chain visibility. One `enabled` flag per chain that is not ready to show.
 * `enabled: false` removes that chain from the home Chain volume table, header
 * search, and price ticker, and makes `/chains/<id>` plus its asset pages
 * `notFound`. Seed rows stay in `mock-data` so flipping the flag brings the
 * chain back. The flag applies in every environment; it is not an env override.
 */
export interface SpotChainConfig {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
}

/**
 * Placeholder seed chain (AAPLon `0xaaaa…`, TSLAon `0xbbbb…`).
 * Set `enabled` to true to list it again.
 */
export const ETHEREUM_CHAIN: SpotChainConfig = {
  id: "ethereum",
  name: "Ethereum",
  enabled: false,
};

const CONFIGURED_CHAINS: readonly SpotChainConfig[] = [ETHEREUM_CHAIN];

export function spotChainConfig(chainId: string): SpotChainConfig | null {
  return CONFIGURED_CHAINS.find((chain) => chain.id === chainId) ?? null;
}

/** Unlisted chains stay visible. A configured chain is visible only when `enabled` is true. */
export function isChainEnabled(chainId: string): boolean {
  const config = spotChainConfig(chainId);
  return config ? config.enabled : true;
}
